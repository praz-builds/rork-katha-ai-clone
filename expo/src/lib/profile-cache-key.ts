/**
 * Where the device copy of the reader's own profile lives.
 *
 * In a module of its own, with no imports, because two modules must name it
 * and cannot import each other: `profile-store` writes it and depends on
 * `session` (through `profile`), and `session` removes it on every way an
 * account can leave the device. Removing it there, next to the cached
 * greeting name, is what stops the next account ever being shown this one.
 *
 * v2 holds a projection scoped to a user id. v1 held the whole row with no
 * owner recorded, and is only ever deleted.
 */
export const OWN_PROFILE_CACHE_KEY = "katha.ownProfile.v2";
export const LEGACY_OWN_PROFILE_CACHE_KEYS = ["katha.ownProfile.v1"] as const;
