---
name: create-documentation
description: >
  Generate documentation for features in this GUI. Use when new
  features are added old, features removed or existing ones are modified and documentation needs to be
  created or updated.
---

# Create Documentation

## Purpose

This skill helps the agent create and update the feature documentation for this project inside /docs/features/

## When to Apply This Skill

The agent should automatically use this skill in this repo when:

- The user **adds or modifies features** and asks for documentation, or
  mentions "docs", "documentation", "API docs", or "docstrings"
- The user asks to **document a module, component, function, or class**

## Workflow

When asked to implement or change features in this project:

1. **Check for existing features**
   - Check inside `/docs/features/` for existing or related features
   - Read the files of relevant features thoroughly

2. **Identify needed modifications or new features**
   - Check if the new feature that is to be implemented violates existing features, deletes it, modifies them or is a completely new feature.
   - On violation: Let the user decide how to proceed. Give suggestions, but don't decide by yourself. DO NOT CONTINUE WITH IMPLEMENTATION WITHOUT USER PERMISSION
   - On deletion: If a feature is removed completely, remove the documentation file aswell to prevent confusion and outdated docs.
   - On change: Modify the existing feature documentation to incorporate the change. Also check if related features might break with this changes.
   - On new feature: Create a new spec file inside `/docs/features/` using the template below. 

4. **Implement the feature**
   - Implement the feature according to the docs.

5. **Check alignment with the docs**
   - Recheck if the modified/added feature really aligns with the created feature documentation.

## Documentation template
In order to allow for a structured development and support process, each feature needs to be documented accordingly. These documentations are the source of truth. If a new feature is added or an existing one is modified, the spec files need to be modified first.

Each feature documentation is put inside the /docs/features/ directory as a seperate file. One file per feature, named XX_FEATURE_NAME.md

XX is a incrementing number for each feature.

Always use the following template for the documentation

```markdown
# XX_FEATURE_NAME

## Description
A brief description of the feature

## UI Interaction
How does the user interact with this feature

## Preconditions
Which preconditions need to be met in order to use this feature

## Event order
What happens once the feature is executed

## User Feedback
What feedback does the user get when interacting with this feature

## Edge Cases
What happens on edge cases

## Errors
Which errors can occur and what happens then

## Related Features
Names of features that relate to this one
```

## Example for a homing feature
`/docs/feature/01_HOMING.md`
```markdown
# 01_HOMING

## Description
User can reference the joints. 
Axes move to their homing switches and set their origin once switches are triggered.
Axes can be homed seperately or all together.

## UI Interaction
The user can start the homing process in the following ways:

**On machine startup**
On startup, a homing window appears. By pressing the CYCLE_START button, 
all axes get homed.
The window also contains buttons to home each axis individually.

**During machine running**
During the running of the machine, axes can be homed by clicking the HOME button. 
A window appears with the options to home all axes or each axis individually.

## Preconditions
- MACHINE_STATE == STATE_ON
- HOMED status for selected axis == UNHOMED
- HOMING status == FALSE

## Event order
- Clicking the homing button fires `HOME` event
	- Payload: {'axes': int of axis to be homed, -1 for all axes}
	
- Backend performs precondition checks again, then sets 'HOMING' Zustand to True.
- Homing buttons are greyed out
- Once homing is finished, the HOMING Zustand is set to FALSE and HOMED status for 
the selected axis is TRUE

## User Feedback
- If a precondition is not met, the button is disabled with a tooltip explaining 
the missing precondition
- If a precondition is not met by the backend, an error message appears with the 
corresponding error message
- During homing, the button is disabled with a tooltip "Homing in Progess"
- Once homed, the homing dialog closes.

## Edge Cases
**E_STOP pressed while homing**
Homing process abort immediatly

## Errors
- If the backend reports an error, a user message with the corresponding error 
text is set

## Related Features
- 02_UNHOMING
```