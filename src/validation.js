const layoutRules = {
  "editorial-hook": {
    required: ["headline"],
    optional: ["accentText"]
  },
  "framework-overview": {
    required: ["title"],
    optional: ["footer"],
    items: true
  },
  statement: {
    required: ["headline"],
    optional: ["body"]
  },
  comparison: {
    required: ["leftTitle", "leftBody", "rightTitle", "rightBody"],
    optional: ["footer"]
  },
  closing: {
    required: ["headline", "body"],
    optional: []
  }
};

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
  assertText(carousel.title, "carousel.title");
  if (carousel.caption !== undefined) assertText(carousel.caption, "carousel.caption");

  assertObject(carousel.style, "carousel.style");
  const expectedStyle = {
    family: "dark-editorial",
    accent: "electric-blue",
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

    for (const field of rule.required) assertText(slide[field], `${path}.${field}`);
    for (const field of rule.optional) {
      if (slide[field] !== undefined) assertText(slide[field], `${path}.${field}`);
    }
    if (rule.items) {
      if (!Array.isArray(slide.items) || slide.items.length < 1 || slide.items.length > 4) {
        throw new Error(`${path}.items must contain 1 to 4 strings`);
      }
      slide.items.forEach((item, itemIndex) => assertText(item, `${path}.items[${itemIndex}]`));
    }
  });

  return carousel;
}

export const supportedLayouts = Object.freeze(Object.keys(layoutRules));
