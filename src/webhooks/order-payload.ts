import { Logger } from '@nestjs/common';
import { z } from 'zod';

const logger = new Logger('parseOrderPayload');

export const OrderPayloadSchema = z.object({
  id: z.number(),
  order_number: z.number(),
  total_price: z.string(),
  currency: z.string(),
  financial_status: z.string(),
  created_at: z.string(),
  customer: z
    .object({
      id: z.number(),
      email: z.string(),
      first_name: z.string(),
      last_name: z.string(),
    })
    .nullable(),
  line_items: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      quantity: z.number().int().positive(),
      price: z.string(),
      variant_id: z.number().nullable(),
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
