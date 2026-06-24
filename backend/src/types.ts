// backend/src/types.ts
//
// Shared Hono context type — defines what c.set() / c.get() can store.
//
// WHY is this needed?
//   Hono uses TypeScript generics to type the context "variables" bag.
//   Without this, `c.get("jwtClaims")` returns `unknown` and you can't
//   destructure `userId` from it — TypeScript complains.
//
//   The fix: define an `AppEnv` type that maps string keys to value types.
//   Pass it as a generic when creating `new Hono<AppEnv>()`.
//   Then `c.get("jwtClaims")` will correctly return `JwtClaims`.
//
// PATTERN:
//   const app = new Hono<AppEnv>()
//   const router = new Hono<AppEnv>()
//   // now c.get("jwtClaims") is typed as JwtClaims everywhere

import type { JwtClaims } from "./middleware/auth";

export type AppEnv = {
  Variables: {
    jwtClaims: JwtClaims;
  };
};
