jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockCreateClient = jest.fn(() => ({
  auth: { getSession: jest.fn() },
  from: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

beforeEach(() => {
  mockCreateClient.mockClear();
  jest.isolateModules(() => {
    require('@/lib/supabase'); // eslint-disable-line @typescript-eslint/no-require-imports
  });
});

describe('supabase client', () => {
  it('creates client with Supabase URL', () => {
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    const call = mockCreateClient.mock.calls[0] as unknown[];
    expect(call[0]).toContain('supabase.co');
  });

  it('configures auth with AsyncStorage persistence', () => {
    const call = mockCreateClient.mock.calls[0] as unknown[];
    const options = call[2] as { auth: { persistSession: boolean; detectSessionInUrl: boolean } };
    expect(options.auth.persistSession).toBe(true);
    expect(options.auth.detectSessionInUrl).toBe(false);
  });

  it('exports isSupabaseConfigured flag', () => {
    let configured: boolean | undefined;
    jest.isolateModules(() => {
      const mod = require('@/lib/supabase'); // eslint-disable-line @typescript-eslint/no-require-imports
      configured = mod.isSupabaseConfigured;
    });
    expect(typeof configured).toBe('boolean');
  });
});
