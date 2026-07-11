/**
 * Branded identity types.
 *
 * A bare `string` id lets you pass a customer id where a contract id is expected
 * and the compiler stays silent. A branded type makes that a type error at no
 * runtime cost — the brand is erased after compilation. This is the cheapest
 * correctness win available in a codebase full of uuid parameters.
 *
 * Usage:
 *   type ContractId = EntityId<'Contract'>;
 *   const id = assertUuid<'Contract'>(input); // validates shape, brands the type
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare const brand: unique symbol;

/** A uuid string branded with the aggregate it identifies. */
export type EntityId<TBrand extends string> = string & { readonly [brand]: TBrand };

/** True if `value` is a syntactically valid uuid (v1-v5, any variant). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Validate that `value` is a uuid and brand it as `EntityId<TBrand>`.
 * @throws {RangeError} if the shape is not a uuid.
 */
export function assertUuid<TBrand extends string>(value: string): EntityId<TBrand> {
  if (!isUuid(value)) {
    throw new RangeError(`Expected a uuid, got "${value}"`);
  }
  return value as EntityId<TBrand>;
}
