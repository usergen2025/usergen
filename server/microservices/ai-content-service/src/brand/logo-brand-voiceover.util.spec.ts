import {
  dedupeMultilingualBrandInVoiceover,
  detectMultilingualBrandDuplication,
  inferBrandNameVariantsFromRaw,
  isMultilingualLogoText,
  isProductNameDuplicateOfBrand,
  resolveCanonicalBrandName,
  splitLogoTextIntoScriptSegments,
} from '@shared/brand/logo-brand-voiceover.util';

describe('logo-brand-voiceover.util', () => {
  const bangBangRaw = 'बैंग बैंग! नूडल BANG BANG! NOODLE';

  describe('splitLogoTextIntoScriptSegments', () => {
    it('splits bilingual Bang Bang logo into Hindi and English segments', () => {
      const segments = splitLogoTextIntoScriptSegments(bangBangRaw);
      expect(segments.length).toBeGreaterThanOrEqual(2);
      expect(segments.some((s) => /[\u0900-\u097F]/.test(s))).toBe(true);
      expect(segments.some((s) => /BANG/i.test(s))).toBe(true);
    });

    it('keeps single-language logo as one segment', () => {
      expect(splitLogoTextIntoScriptSegments('Acme Corp')).toEqual(['Acme Corp']);
    });
  });

  describe('resolveCanonicalBrandName', () => {
    const ctx = {
      rawLogoText: bangBangRaw,
      brandName: 'Bang Bang Noodle',
      brandNameVariants: ['बैंग बैंग नूडल', 'BANG BANG NOODLE'],
    };

    it('returns English form for hinglish', () => {
      const name = resolveCanonicalBrandName(ctx, 'hinglish');
      expect(name).toMatch(/Bang Bang/i);
      expect(name).not.toMatch(/[\u0900-\u097F]/);
    });

    it('returns English form for english', () => {
      const name = resolveCanonicalBrandName(ctx, 'english');
      expect(name).toMatch(/Bang Bang/i);
      expect(name).not.toMatch(/[\u0900-\u097F]/);
    });

    it('returns Hindi form for hindi', () => {
      const name = resolveCanonicalBrandName(ctx, 'hindi');
      expect(name).toMatch(/[\u0900-\u097F]/);
    });

    it('resolves from raw OCR when brandName missing', () => {
      const name = resolveCanonicalBrandName({ rawLogoText: bangBangRaw }, 'english');
      expect(name).toMatch(/Bang Bang/i);
    });

    it('leaves single-language brand unchanged', () => {
      expect(
        resolveCanonicalBrandName({ brandName: 'Acme Industries' }, 'english'),
      ).toBe('Acme Industries');
    });
  });

  describe('detectMultilingualBrandDuplication', () => {
    it('flags screenshot-style duplicate brand voiceover', () => {
      const vo =
        'Craving something spicy? Discover the bold flavors of बैंग बैंग! नूडल BANG BANG! NOODLE.';
      expect(detectMultilingualBrandDuplication(vo)).toBe(true);
    });

    it('does not flag single-script brand mention', () => {
      expect(detectMultilingualBrandDuplication('Try Bang Bang Noodle today.')).toBe(false);
      expect(detectMultilingualBrandDuplication('बैंग बैंग नूडल आजमाइए।')).toBe(false);
    });
  });

  describe('dedupeMultilingualBrandInVoiceover', () => {
    it('replaces bilingual OCR recitation with canonical English brand', () => {
      const vo =
        'Craving a burst of flavor? Discover the magic of बैंग बैंग! नूडल BANG BANG! NOODLE.';
      const fixed = dedupeMultilingualBrandInVoiceover(
        vo,
        'Bang Bang Noodle',
        ['बैंग बैंग नूडल', 'BANG BANG NOODLE'],
        bangBangRaw,
      );
      expect(fixed).toMatch(/Bang Bang Noodle/i);
      expect(fixed).not.toMatch(/[\u0900-\u097F]/);
      expect(detectMultilingualBrandDuplication(fixed)).toBe(false);
    });

    it('replaces bilingual OCR with canonical Hindi brand', () => {
      const vo =
        'स्वाद की तलाश? बैंग बैंग! नूडल BANG BANG! NOODLE — आजमाएं।';
      const fixed = dedupeMultilingualBrandInVoiceover(
        vo,
        'बैंग बैंग नूडल',
        ['बैंग बैंग नूडल', 'BANG BANG NOODLE'],
        bangBangRaw,
      );
      expect(fixed).toMatch(/बैंग बैंग नूडल/);
      expect(fixed).not.toMatch(/BANG BANG/i);
      expect(detectMultilingualBrandDuplication(fixed)).toBe(false);
    });
  });

  describe('isMultilingualLogoText', () => {
    it('detects bilingual logo OCR', () => {
      expect(isMultilingualLogoText(bangBangRaw)).toBe(true);
      expect(isMultilingualLogoText('Acme Corp', [])).toBe(false);
    });
  });

  describe('inferBrandNameVariantsFromRaw', () => {
    it('infers multiple variants from bilingual OCR', () => {
      const variants = inferBrandNameVariantsFromRaw(bangBangRaw);
      expect(variants.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('isProductNameDuplicateOfBrand', () => {
    it('detects product name matching brand', () => {
      expect(
        isProductNameDuplicateOfBrand('BANG BANG NOODLE', 'Bang Bang Noodle'),
      ).toBe(true);
    });

    it('allows distinct product names', () => {
      expect(
        isProductNameDuplicateOfBrand('Spicy Dumplings', 'Bang Bang Noodle'),
      ).toBe(false);
    });
  });
});
