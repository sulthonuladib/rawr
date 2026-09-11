# effect-schema — Schema at edges (effect@4.0.0-rc.113)

Source: `repos/effect/packages/effect/src/Schema.ts`, `repos/effect/LLMS.md`,
`repos/effect/ai-docs/src/01_effect/02_schema/10_schema-basics.ts`,
test: `packages/effect/test/testing/TestSchema.test.ts`.
App code imports from `effect`, never from `repos/**`.

## Constructors (prefer these)

```ts
import { Schema } from "effect"

Schema.String; Schema.Number; Schema.Boolean; Schema.Int
Schema.NonEmptyString; Schema.NumberFromString; Schema.DateTimeUtc
Schema.Literal("a"); Schema.Literals(["admin", "member"])
Schema.Struct({ id: Schema.Int, name: Schema.String })
Schema.Array(Schema.String); Schema.Record({ key: Schema.String, value: Schema.Number })
Schema.Union(Schema.String, Schema.Number); Schema.NullOr(Schema.String)
Schema.optional(Schema.String) // field: string | undefined
Schema.optionalKey(Schema.String) // key may be absent
```

Model: `Schema.Class` (see example below). Union of models: `Schema.TaggedClass` + `Schema.Union`.

## Decode / encode (edges only)

```ts
export const decodeUser = Schema.decodeUnknownEffect(User)
export const encodeUser = Schema.encodeEffect(User)
// sync variant: Schema.decodeUnknownSync(User)(input) // throws SchemaError
// promise/result/option: decodeUnknownPromise / decodeUnknownResult / decodeUnknownOption
// encode mirrors: encodeEffect / encodeSync / encodeUnknownSync

export type UserType = typeof User["Type"]
export type UserEncoded = typeof User["Encoded"]
```

Reuse parsers (define once, call at HTTP/WS/AMQP edge). Inside `Effect`
use `Effect`-returning APIs so errors stay in channel. Map to domain error
with `Effect.mapError`.

## Branded types

```ts
const UserId = Schema.String.pipe(Schema.brand("UserId"))
type UserId = typeof UserId["Type"] // string & Brand<"UserId">
// with runtime check: Schema.fromBrand("UserId", ctor)(Schema.String)
// custom guard: Schema.declare<UserId>((u): u is UserId => typeof u === "string" && u.startsWith("user_"))
```

`brand` is type-only; use `fromBrand`/`declare`/`.check()` for runtime checks.

## TaggedError (only error pattern)

```ts
export class InvalidPayload extends Schema.TaggedError<InvalidPayload>()("InvalidPayload", {
  message: Schema.String
}) {}

return yield* new InvalidPayload({ message: error.message }) // always `return yield*`
```

Catch with `Effect.catchTag("InvalidPayload", ...)` / `catchTags`.

## Minimal example (from vendored ai-docs)

```ts
import { Effect, Schema } from "effect"

export class User extends Schema.Class<User>("path/to/module/User")({
  id: Schema.Int, name: Schema.NonEmptyString,
  email: Schema.String, role: Schema.Literals(["admin", "member"])
}) {}

export const decodeUser = Schema.decodeUnknownEffect(User)
export const encodeUser = Schema.encodeEffect(User)
```

## Don't

- No `zod`, no `Predicate`-bypass, no manual `isX`/parse, no `JSON.parse` without Schema.
- No `throw`; fail with `Schema.TaggedError` + `return yield*`.
- No per-request parser construction; no `Effect.gen` wrapper that only returns `Effect.gen`.
- No `Schema.asserts`/sync decode inside Effect code (use `decodeUnknownEffect`).
