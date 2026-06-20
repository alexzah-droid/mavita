import { describe, expect, it } from 'vitest'
import { slugify } from '@/lib/slug'
describe('slugify', () => it('транслитерирует и нормализует', () => expect(slugify('Свеча: Ёлка & Мох!')).toBe('svecha-elka-moh')))
