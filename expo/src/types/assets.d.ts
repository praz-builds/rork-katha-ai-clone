/**
 * Bundled image assets, as Metro hands them to JavaScript.
 *
 * Metro replaces an image import with a NUMBER - the id of an entry in the
 * asset registry - which is exactly what `<Image source>` takes. Typing it as
 * `number` rather than `any` keeps `source={STAGE_CAST[0].source}` checked: a typo'd
 * path is a missing module, and a string URL passed where a required asset
 * belongs is a type error rather than a blank frame on device.
 */
declare module "*.png" {
  const source: number;
  export default source;
}

declare module "*.jpg" {
  const source: number;
  export default source;
}

declare module "*.webp" {
  const source: number;
  export default source;
}
