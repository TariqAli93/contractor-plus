import type { Prisma } from '@prisma/client';

/**
 * Convert a Prisma model object (with Dates / Decimals) into a JSON-safe value
 * suitable for storing in a Json column. Crude but adequate for audit snapshots.
 */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
