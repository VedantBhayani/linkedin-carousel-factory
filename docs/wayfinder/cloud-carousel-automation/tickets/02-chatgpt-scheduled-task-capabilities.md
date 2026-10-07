---
title: Verify the cloud ChatGPT orchestration boundary
label: wayfinder:research
status: closed
parent: Cloud Carousel Automation
blocked_by: []
---

## Question

Using current official OpenAI documentation, which connected sources, event/schedule triggers, file operations, plugins, and unattended actions can a cloud ChatGPT scheduled task reliably perform without a local desktop project or OpenAI API?

## Resolution

Cloud/web scheduled tasks can run from a saved prompt and use uploaded files, connected tools, skills, and plugins available to the task, but they do not retain a local folder or worktree. Durable inputs and outputs must live in a project, Library, or connected cloud service. Event triggers are limited to documented events in Gmail, Slack, and GitHub; a generic connected source is not automatically an event source. Writes can run unattended only when the integration exposes the action and workspace policy permits it. Therefore the cloud carousel system must hand durable jobs through connected storage or GitHub and must not depend on a desktop session or ephemeral task filesystem.

Sources: [Scheduled tasks](https://learn.chatgpt.com/docs/automations), [Teams and Team Tasks](https://learn.chatgpt.com/docs/enterprise/teams), [Cloud security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-cloud-security).
