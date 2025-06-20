import Store from 'electron-store';

// Initialize the store with schema validation
const store = new Store({
  name: 'recent-projects',
  schema: {
    recentProjects: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          path: { type: 'string' },
          lastUsed: { type: 'string' }
        },
        required: ['name', 'path', 'lastUsed']
      },
      maxItems: 3
    }
  }
});

/**
 * Gets the list of recent projects
 * @returns {Array} Array of recent project objects
 */
export const getRecentProjects = () => {
  return store.get('recentProjects', []);
};

/**
 * Adds a project to the recent projects list
 * @param {string} projectPath - Full path to the project directory
 */
export const addRecentProject = (projectPath) => {
  const projectName = projectPath.split('/').pop() || 'Unknown Project';
  const recentProjects = getRecentProjects();

  // Remove existing entry if it exists
  const filteredProjects = recentProjects.filter(p => p.path !== projectPath);

  // Add to beginning of array
  const updatedProjects = [{
    name: projectName,
    path: projectPath,
    lastUsed: new Date().toISOString()
  }, ...filteredProjects];

  // Keep only last 3 projects
  const finalProjects = updatedProjects.slice(0, 3);

  // Save to store
  store.set('recentProjects', finalProjects);

  return finalProjects;
};

/**
 * Removes a project from the recent projects list
 * @param {string} projectPath - Full path to the project directory to remove
 */
export const removeRecentProject = (projectPath) => {
  const recentProjects = getRecentProjects();
  const filteredProjects = recentProjects.filter(p => p.path !== projectPath);
  store.set('recentProjects', filteredProjects);
  return filteredProjects;
};

/**
 * Clears all recent projects
 */
export const clearRecentProjects = () => {
  store.set('recentProjects', []);
  return [];
};

/**
 * Checks if a project path exists in recent projects
 * @param {string} projectPath - Full path to check
 * @returns {boolean} True if project exists in recent list
 */
export const hasRecentProject = (projectPath) => {
  const recentProjects = getRecentProjects();
  return recentProjects.some(p => p.path === projectPath);
};