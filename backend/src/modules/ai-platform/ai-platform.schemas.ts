import { z } from 'zod';

export const openSessionBodySchema = z.object({
  title: z.string().trim().max(200).optional(),
});

export const messageBodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

export const sessionParamSchema = z.object({ id: z.string().uuid() });

export type OpenSessionBody = z.infer<typeof openSessionBodySchema>;
export type MessageBody = z.infer<typeof messageBodySchema>;
