# Glossary

## Asset

An approved visual file, such as a logo, icon, texture, or image, identified by a stable asset ID. An asset is data consumed by a component; it is not a component or style.

## Buffer Draft

The terminal output of the first cloud automation effort: an unpublished LinkedIn draft in Buffer containing the verified carousel media and caption.

## Carousel Job

One traceable attempt to transform a source post into a verified Buffer draft. A job owns its content specification, references used, design-system versions, render attempts, assets, events, and publication record.

## Component

A reusable visual building block inside a layout, such as a numbered card or tool-logo pill.

## Design Pattern

A reusable visual or narrative idea observed in one or more references. A pattern is descriptive until explicitly implemented and approved as a style, layout, or component.

## Layout

The spatial and hierarchical arrangement of content on one slide. Layout is independent of color and typography tokens.

## Reference

An uploaded image, slide, or full carousel used as inspiration and analysis material. A reference never becomes executable production code merely by being uploaded.

## Reference Analysis

A versioned description of one Reference Set's visual and narrative characteristics. It can guide retrieval but cannot activate layouts, components, styles, or assets.

## Reference Collection

A curated group of references used to constrain or guide retrieval for a carousel job.

## Reference Set

One ordered unit of visual inspiration: a standalone image, a complete PDF, or a grouped sequence of carousel slide images. Its original files and slide order are preserved.

## Queue Record

The Google Sheet row that holds a carousel job's current lifecycle state and durable pointers to its external artifacts. It is the coordination record, not the storage location for full job payloads or verbose logs.

## Render Attempt

One identified execution of the deterministic renderer for a carousel job. An attempt may succeed, fail, or require reconciliation without creating a new carousel job.

## Render Worker

The single cloud execution role that claims eligible queue records and deterministically produces verified carousel assets. It does not perform editorial reasoning.

## Style

A versioned set of visual tokens such as colors, typography, spacing, radii, borders, and effects. A style does not determine slide content or spatial structure.

## Style Package

An approved executable bundle containing style tokens and compatibility metadata for the layouts and components it supports.
