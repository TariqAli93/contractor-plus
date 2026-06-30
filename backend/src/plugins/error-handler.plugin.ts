import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/app-error.js';

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.flatten().fieldErrors,
        reqId: request.id,
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, reqId: request.id });
      }
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        details: error.details,
        reqId: request.id,
      });
    }

    // Fastify framework / plugin errors (CSRF rejection, malformed JSON body,
    // payload-too-large, …) carry a numeric statusCode + machine code. Surface
    // genuine 4xx client errors with their real status instead of masking them
    // as a 500; anything else falls through to the generic, detail-free 500.
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        code: error.code || 'BAD_REQUEST',
        message: error.message,
        reqId: request.id,
      });
    }

    request.log.error({ err: error, reqId: request.id });
    return reply.code(500).send({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      reqId: request.id,
    });
  });
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
