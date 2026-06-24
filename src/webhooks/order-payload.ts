import { Logger } from '@nestjs/common';
import { z } from 'zod';

const logger = new Logger('parseOrderPayload');

const bigIntId = z.union([z.string(), z.number()]).transform(String);

export const OrderPayloadSchema = z.object({
  id: bigIntId,
  order_number: z.number(),
  total_price: z.string(),
  currency: z.string(),
  financial_status: z.string(),
  created_at: z.string(),
  customer: z
    .object({
      id: bigIntId,
      email: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    })
    .nullable()
    .optional(),
  line_items: z.array(
    z.object({
      id: bigIntId,
      title: z.string(),
      quantity: z.number().int().positive(),
      price: z.string(),
      variant_id: z
        .union([z.string(), z.number()])
        .transform(String)
        .nullish(),
    }),
  ),
});

export type OrderPayload = z.infer<typeof OrderPayloadSchema>;

export function parseOrderPayload(raw: unknown): OrderPayload {
  const result = OrderPayloadSchema.safeParse(raw);

  if (!result.success) {
    const summary = result.error.issues
      .map((i) => `[${i.path.join('.')}] ${i.message}`)
      .join('; ');
    throw new Error(`Invalid orders/create payload: ${summary}`);
  }

  const order = result.data;

  if (order.customer === null) {
    logger.log(
      `order #${order.order_number} is a guest checkout (no customer)`,
    );
  }

  for (const item of order.line_items) {
    if (item.price === '0.00') {
      logger.warn(
        `order #${order.order_number} — line item "${item.title}" (id=${item.id}) has price 0.00`,
      );
    }
  }

  return order;
}
