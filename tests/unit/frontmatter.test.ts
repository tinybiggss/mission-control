import { describe, it, expect } from 'vitest';
import { parseDraftFile, parseAdaptedFile, serializeFrontmatter, normalizeTargetPlatforms } from '../../src/lib/server/frontmatter';

describe('normalizeTargetPlatforms', () => {
  it('returns array unchanged when already array', () => {
    expect(normalizeTargetPlatforms(['linkedin', 'x-twitter'])).toEqual(['linkedin', 'x-twitter']);
  });

  it('parses YAML block scalar string with dashes', () => {
    const input = '\n  - linkedin\n  - x-twitter';
    expect(normalizeTargetPlatforms(input)).toEqual(['linkedin', 'x-twitter']);
  });

  it('parses single-line dash-prefixed string', () => {
    expect(normalizeTargetPlatforms('- linkedin')).toEqual(['linkedin']);
  });

  it('returns empty array for null/undefined', () => {
    expect(normalizeTargetPlatforms(null)).toEqual([]);
    expect(normalizeTargetPlatforms(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(normalizeTargetPlatforms('')).toEqual([]);
  });
});

describe('parseDraftFile', () => {
  it('parses a draft markdown file with frontmatter', () => {
    const content = `---
id: draft-2026-04-15-001
status: draft
created: 2026-04-15
source_signal: Victory Gardens Are Having a Mainstream Moment
source_signal_url: https://example.com
source_score: 4.0
pillar: Food Independence
target_platforms:
  - linkedin
  - x-twitter
headline_formula: "[Thing You Want] Is the [Trap]"
content_type: text-draft
visual_brief: ""
video_brief: ""
napkin_asset: ""
gamma_asset: ""
---

# Victory Gardens

Body content here.
`;
    const result = parseDraftFile(content, '/fake/path/draft-2026-04-15-001.md');
    expect(result.id).toBe('draft-2026-04-15-001');
    expect(result.status).toBe('draft');
    expect(result.source_score).toBe(4.0);
    expect(result.target_platforms).toEqual(['linkedin', 'x-twitter']);
    expect(result.body.trim()).toBe('# Victory Gardens\n\nBody content here.');
    expect(result.filePath).toBe('/fake/path/draft-2026-04-15-001.md');
  });

  it('normalizes block-scalar target_platforms', () => {
    const content = `---
id: draft-2026-04-15-002
status: draft
created: 2026-04-15
source_signal: x
source_signal_url: x
source_score: 3.5
pillar: Food
target_platforms: |

  - linkedin
headline_formula: x
content_type: text-draft
visual_brief: ""
video_brief: ""
napkin_asset: ""
gamma_asset: ""
---

body
`;
    const result = parseDraftFile(content, '/fake/path/draft-2026-04-15-002.md');
    expect(result.target_platforms).toEqual(['linkedin']);
  });
});

describe('parseAdaptedFile', () => {
  it('parses an adapted markdown file', () => {
    const content = `---
source_draft: draft-2026-04-15-002
platform: linkedin
status: pending-approval
scheduled_date: ""
character_count: 432
visual_required: false
visual_brief: ""
subreddit: ""
---

# Adapted headline

Adapted body.
`;
    const result = parseAdaptedFile(
      content,
      '/fake/vault/Content Adapted/2026-04-15/draft-2026-04-15-002/linkedin.md'
    );
    expect(result.draftId).toBe('draft-2026-04-15-002');
    expect(result.platform).toBe('linkedin');
    expect(result.status).toBe('pending-approval');
    expect(result.character_count).toBe(432);
    expect(result.visual_required).toBe(false);
    expect(result.id).toBe('draft-2026-04-15-002/linkedin');
    expect(result.body.trim()).toBe('# Adapted headline\n\nAdapted body.');
  });
});

describe('serializeFrontmatter', () => {
  it('writes frontmatter + body back to string', () => {
    const result = serializeFrontmatter(
      { source_draft: 'draft-001', status: 'approved', character_count: 100 },
      'body content'
    );
    expect(result).toContain('source_draft: draft-001');
    expect(result).toContain('status: approved');
    expect(result).toContain('character_count: 100');
    expect(result).toContain('body content');
    expect(result.startsWith('---\n')).toBe(true);
  });
});
