/**
 * Regression guard for CVE-2025-71329 (JXL) and CVE-2025-71330 (ICNS).
 *
 * image-size 1.2.1 walks a container by adding each box's declared length to a
 * cursor. A crafted file that declares a length of zero leaves the cursor where
 * it was, so the parser loops forever and grows its result array until the
 * process dies. Upstream has shipped no fixed release — 2.0.2, the latest, is
 * still vulnerable — and metro pins image-size to ^1.0.2, so both loops are
 * patched in place via patches/image-size@1.2.1.patch.
 *
 * image-size reaches us through metro, which measures asset dimensions at
 * bundle time, so the blast radius is a build that never finishes rather than
 * anything running on a reader's phone. The patch is still easy to lose: any
 * `pnpm install` against a pnpm-workspace.yaml that has lost its
 * patchedDependencies entry silently restores the vulnerable copy. This test
 * fails when that happens.
 *
 * The parse runs in a child process because an unpatched image-size spins in a
 * synchronous loop — it would block the event loop, so Jest's own timeout could
 * never fire and the run would hang instead of failing.
 */
/*
 * This file reaches for Node's own APIs, which the Expo tsconfig deliberately
 * does not type -- @types/node would redefine globals like setTimeout for the
 * whole app. The handful of surfaces used here are declared locally instead, so
 * the shim stays inside this test rather than leaking into the client's types.
 */
type SpawnResult = { status: number | null };
type SpawnSync = (
  command: string,
  args: string[],
  options: { timeout: number; encoding: string },
) => SpawnResult;

const nodeRequire = require as unknown as {
  (id: string): unknown;
  resolve(id: string): string;
};
const { spawnSync } = nodeRequire('child_process') as { spawnSync: SpawnSync };
const nodeExecPath = (globalThis as unknown as { process: { execPath: string } })
  .process.execPath;

const PARSE_TIMEOUT_MS = 10_000;

/**
 * image-size is a transitive dependency of metro, so pnpm does not link it at
 * the app root -- plain Node cannot resolve it from here. Jest's resolver can,
 * because it reads pnpm's hoisted directory, and that is what runs this file.
 * The distinction matters when it breaks: without this guard a resolution
 * failure would surface as the child process exiting non-zero, which reads as
 * "the patch is gone" rather than "the module moved".
 */
function resolveImageSize(): string {
  try {
    return nodeRequire.resolve('image-size');
  } catch {
    throw new Error(
      'Could not resolve image-size. It is a transitive metro dependency, so ' +
        'this usually means pnpm hoisting changed rather than that the CVE ' +
        'patch was lost -- check pnpm-workspace.yaml before assuming the worst.',
    );
  }
}

/** An ICNS file whose first image header declares a length of zero. */
const ICNS_SCRIPT = `
  const buf = Buffer.alloc(64);
  buf.write('icns', 0, 'ascii');
  buf.writeUInt32BE(64, 4);      // total file length
  buf.write('ic07', 8, 'ascii'); // image header type
  buf.writeUInt32BE(0, 12);      // image header length — the bomb
  return new Uint8Array(buf);
`;

/** A JXL container whose 'jxlp' partial-codestream box declares a length of zero. */
const JXL_SCRIPT = `
  const signature = Buffer.alloc(12);
  signature.writeUInt32BE(12, 0);
  signature.write('JXL ', 4, 'ascii');
  signature.writeUInt32BE(0x0d0a870a, 8);

  const ftyp = Buffer.alloc(20);
  ftyp.writeUInt32BE(20, 0);
  ftyp.write('ftyp', 4, 'ascii');
  ftyp.write('jxl ', 8, 'ascii');

  const jxlp = Buffer.alloc(24);
  jxlp.writeUInt32BE(0, 0);      // box length — the bomb
  jxlp.write('jxlp', 4, 'ascii');

  return new Uint8Array(Buffer.concat([signature, ftyp, jxlp]));
`;

/**
 * Parses a hostile buffer in a child process. Resolves to true when image-size
 * gives control back — answering or rejecting the file both count, only looping
 * forever is a failure.
 */
function parseTerminates(buildBuffer: string): boolean {
  const source = `
    const { imageSize } = require(${JSON.stringify(resolveImageSize())});
    const build = () => { ${buildBuffer} };
    try { imageSize(build()); } catch {}
    process.exit(0);
  `;
  const result = spawnSync(nodeExecPath, ['-e', source], {
    timeout: PARSE_TIMEOUT_MS,
    encoding: 'utf8',
  });
  return result.status === 0;
}

describe('image-size is patched against the zero-length-box infinite loops', () => {
  it('terminates on a malicious ICNS header (CVE-2025-71330)', () => {
    expect(parseTerminates(ICNS_SCRIPT)).toBe(true);
  }, 30_000);

  it('terminates on a malicious JXL partial stream (CVE-2025-71329)', () => {
    expect(parseTerminates(JXL_SCRIPT)).toBe(true);
  }, 30_000);
});
