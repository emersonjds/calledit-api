import { describe, it, expect } from 'vitest';
import { statProofPath } from './proof.js';

describe('statProofPath', () => {
  it('builds the v3 endpoint with query params', () => {
    expect(statProofPath(12345, 1, '1')).toBe(
      '/api/scores/stat-validation-v3?fixtureId=12345&seq=1&statKeys=1',
    );
  });
  it('passes multiple stat keys verbatim', () => {
    expect(statProofPath(9, 3, '1,3,7')).toBe(
      '/api/scores/stat-validation-v3?fixtureId=9&seq=3&statKeys=1%2C3%2C7',
    );
  });
});
