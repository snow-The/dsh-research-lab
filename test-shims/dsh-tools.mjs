// Stand-in for @deepseek-ai/dsh-tools when a test drives the BUNDLE outside the harness:
// defineTool is a definition helper, so identity is the whole contract these tests rely on.
export const defineTool = (definition) => definition;
export default { defineTool };
