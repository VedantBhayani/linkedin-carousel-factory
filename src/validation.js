const layoutRules = {
  "editorial-hook": {
    required: ["headline"],
    optional: ["accentText", "eyebrow"]
  },
  "framework-overview": {
    required: ["title"],
    optional: ["footer", "eyebrow"],
    items: true
  },
  statement: {
    required: ["headline"],
    optional: ["body"]
  },
  comparison: {
    required: ["leftTitle", "leftBody", "rightTitle", "rightBody"],
    optional: ["footer", "eyebrow", "title", "leftLabel", "rightLabel"]
  },
  closing: {
    required: ["headline", "body"],
    optional: ["eyebrow"]
  }
};

// Copy limits. Headline and body limits are the scheduled-task prompt's rules ("headlines
// under 12 words, bodies under 25 words"), enforced here so they are not prompt-only.
// Label limits keep the small uppercase labels on one line.
const HEADLINE = { words: 11 };
const BODY = { words: 24 };
const fieldLimits = {
  headline: HEADLINE,
  title: HEADLINE,
  leftTitle: HEADLINE,
  rightTitle: HEADLINE,
  accentText: BODY,
  body: BODY,
  footer: BODY,
  leftBody: BODY,
  rightBody: BODY,
  items: BODY,
  eyebrow: { words: 6, chars: 40 },
  leftLabel: { words: 3, chars: 24 },
  rightLabel: { words: 3, chars: 24 }
};

const carouselFields = new Set(["jobId", "title", "caption", "style", "slides", "referenceCollection"]);

function assertKnownFields(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path} has unsupported field "${key}"`);
  }
}

function assertLimit(value, limit, path) {
  if (!limit) return;
  const words = value.trim().split(/\s+/).length;
  if (limit.words && words > limit.words) throw new Error(`${path} must be at most ${limit.words} words`);
  if (limit.chars && value.trim().length > limit.chars) throw new Error(`${path} must be at most ${limit.chars} characters`);
}

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertText(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

export function validateCarousel(carousel) {
  assertObject(carousel, "carousel");
  assertKnownFields(carousel, carouselFields, "carousel");
  assertText(carousel.title, "carousel.title");
  if (carousel.caption !== undefined) assertText(carousel.caption, "carousel.caption");

  assertObject(carousel.style, "carousel.style");
  const expectedStyle = {
    family: "dark-editorial",
    accent: "editorial-purple",
    density: "low"
  };
  for (const [key, expected] of Object.entries(expectedStyle)) {
    assertText(carousel.style[key], `carousel.style.${key}`);
    if (carousel.style[key] !== expected) {
      throw new Error(`carousel.style.${key} must be \"${expected}\"`);
    }
  }

  if (!Array.isArray(carousel.slides) || carousel.slides.length !== 8) {
    throw new Error("carousel.slides must contain exactly 8 slides");
  }

  carousel.slides.forEach((slide, index) => {
    const path = `carousel.slides[${index}]`;
    assertObject(slide, path);
    assertText(slide.layout, `${path}.layout`);
    const rule = layoutRules[slide.layout];
    if (!rule) throw new Error(`${path}.layout has unsupported value \"${slide.layout}\"`);
    assertKnownFields(slide, new Set(["layout", ...rule.required, ...rule.optional, ...(rule.items ? ["items"] : [])]), path);

    for (const field of rule.required) {
      assertText(slide[field], `${path}.${field}`);
      assertLimit(slide[field], fieldLimits[field], `${path}.${field}`);
    }
    for (const field of rule.optional) {
      if (slide[field] === undefined) continue;
      assertText(slide[field], `${path}.${field}`);
      assertLimit(slide[field], fieldLimits[field], `${path}.${field}`);
    }
    if (rule.items) {
      if (!Array.isArray(slide.items) || slide.items.length < 1 || slide.items.length > 4) {
        throw new Error(`${path}.items must contain 1 to 4 strings`);
      }
      slide.items.forEach((item, itemIndex) => {
        assertText(item, `${path}.items[${itemIndex}]`);
        assertLimit(item, fieldLimits.items, `${path}.items[${itemIndex}]`);
      });
    }
  });

  return carousel;
}

export const supportedLayouts = Object.freeze(Object.keys(layoutRules));
