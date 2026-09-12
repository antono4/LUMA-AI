```markdown
# LUMA-AI Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the LUMA-AI repository, a TypeScript codebase with a focus on consistent file naming, import/export styles, and conventional commit messages. It provides guidance on writing code, structuring files, and running tests, ensuring maintainability and clarity across the project.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myComponent.ts`, `userProfileManager.ts`

### Import Style
- Use **relative imports** for referencing modules within the project.
  - Example:
    ```typescript
    import { myFunction } from './utils';
    import UserProfile from '../models/userProfile';
    ```

### Export Style
- Use **mixed exports** (both named and default exports are present).
  - Example:
    ```typescript
    // Named export
    export function calculateScore() { ... }

    // Default export
    export default class UserProfile { ... }
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `feat` prefix for new features.
- Keep commit messages concise (average 47 characters).
  - Example: `feat: add user authentication module`

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new feature or module  
**Command:** `/add-feature`

1. Create a new file using camelCase naming.
2. Write code using TypeScript, following relative import style.
3. Export your functions or classes using named or default exports as appropriate.
4. Write corresponding tests in a `.test.ts` file.
5. Commit changes with a message like `feat: [short description]`.

### Writing Tests
**Trigger:** When adding or updating functionality  
**Command:** `/write-test`

1. Create a test file named `yourFeature.test.ts` in the relevant directory.
2. Write tests using the project's preferred (unknown) framework.
3. Use relative imports to bring in code under test.
4. Run tests to ensure correctness.

## Testing Patterns

- Test files follow the `*.test.*` naming pattern.
  - Example: `userProfile.test.ts`
- The specific testing framework is not detected, but tests should be colocated with or near the code they test.
- Example test file:
  ```typescript
  import { calculateScore } from './calculateScore';

  test('should return correct score', () => {
    expect(calculateScore([1, 2, 3])).toBe(6);
  });
  ```

## Commands
| Command        | Purpose                                  |
|----------------|------------------------------------------|
| /add-feature   | Scaffold and commit a new feature/module |
| /write-test    | Create and run tests for a module        |
```
