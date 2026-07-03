import { mockReset } from 'jest-mock-extended';
import prismaMock from './src/app/config/__mocks__/prisma';

beforeEach(() => {
  mockReset(prismaMock);
});
