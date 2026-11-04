import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TaskLume API',
      version: '1.0.0',
      description: 'TaskLume backend API',
    },
    servers: [
      { url: '/api/v1', description: 'Version 1' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // Resolve relative to this file so it works from src/ (tsx) and dist/ (node)
  apis: [path.join(__dirname, '../routes/*.{ts,js}')],
};

export const swaggerSpec = swaggerJsdoc(options);
