import { validateSoc, validateDecision, normalizeSoc, SOC_MAX_LENGTH } from '../../../src/logic/device-support'

describe('device-support logic', () => {
  describe('validateSoc', () => {
    it('accepts a normal SoC and rejects a missing or blank one', () => {
      expect(validateSoc('MT6765')).toBeNull()
      expect(validateSoc('')).toMatch(/required/)
      expect(validateSoc('   ')).toMatch(/required/)
      expect(validateSoc(undefined)).toMatch(/required/)
      expect(validateSoc(42)).toMatch(/required/)
    })

    it('rejects a SoC longer than SOC_MAX_LENGTH once trimmed', () => {
      expect(validateSoc('A'.repeat(SOC_MAX_LENGTH))).toBeNull()
      expect(validateSoc('A'.repeat(SOC_MAX_LENGTH + 1))).toMatch(/at most 64/)
    })

    it('length-checks the trimmed value, not the raw one -- padding alone must not reject it', () => {
      // 64 meaningful characters padded with whitespace that normalizeSoc strips before storage;
      // the raw string is longer than the limit but the stored value fits exactly.
      const padded = `  ${'A'.repeat(SOC_MAX_LENGTH)}  `
      expect(padded.length).toBeGreaterThan(SOC_MAX_LENGTH)

      expect(validateSoc(padded)).toBeNull()
    })
  })

  describe('validateDecision', () => {
    it('accepts the two known decisions and rejects anything else', () => {
      expect(validateDecision('exclude')).toBeNull()
      expect(validateDecision('below-minspec')).toBeNull()
      expect(validateDecision('keep')).toMatch(/must be one of/)
      expect(validateDecision('')).toMatch(/must be one of/)
      expect(validateDecision(undefined)).toMatch(/must be one of/)
    })
  })

  describe('normalizeSoc', () => {
    it('trims and uppercases without touching internal spacing', () => {
      expect(normalizeSoc('  exynos 7420  ')).toBe('EXYNOS 7420')
      expect(normalizeSoc('mt6765')).toBe('MT6765')
    })
  })
})
