import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { listProjectLogFiles, prepareProject, resolveProjectLogFile } from '../projectManager.js';

const temporaryDirectories = [];

const createRailsProject = async ({ logFiles = [] } = {}) => {
  const projectPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logspect-project-'));
  temporaryDirectories.push(projectPath);

  await fs.promises.writeFile(path.join(projectPath, 'Gemfile'), "source 'https://rubygems.org'\ngem 'rails'\n");

  for (const logFilePath of logFiles) {
    const absoluteLogFilePath = path.join(projectPath, logFilePath);
    await fs.promises.mkdir(path.dirname(absoluteLogFilePath), { recursive: true });
    await fs.promises.writeFile(absoluteLogFilePath, `${logFilePath}\n`);
  }

  return projectPath;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => (
    fs.promises.rm(directoryPath, { recursive: true, force: true })
  )));
});

describe('Project Manager', () => {
  it('lists available project log files with development.log first', async () => {
    const projectPath = await createRailsProject({
      logFiles: ['log/production.log', 'log/development.log', 'prod-logs/sidekiq.log']
    });

    const result = await listProjectLogFiles(projectPath);

    expect(result.exists).toBe(true);
    expect(result.files.map(file => file.relativePath)).toEqual([
      'log/development.log',
      'log/production.log',
      'prod-logs/sidekiq.log'
    ]);
  });

  it('prefers development.log when preparing a project', async () => {
    const projectPath = await createRailsProject({
      logFiles: ['log/production.log', 'log/development.log']
    });

    const result = await prepareProject(projectPath);

    expect(result.success).toBe(true);
    expect(result.logPath).toBe(path.join(projectPath, 'log', 'development.log'));
    expect(result.availableLogFiles).toHaveLength(2);
  });

  it('falls back to the first available log file when development.log is missing', async () => {
    const projectPath = await createRailsProject({
      logFiles: ['log/production.log', 'prod-logs/sidekiq.log']
    });

    const result = await prepareProject(projectPath);

    expect(result.success).toBe(true);
    expect(result.logPath).toBe(path.join(projectPath, 'log', 'production.log'));
  });

  it('accepts switching to another log file inside the project log directory', async () => {
    const projectPath = await createRailsProject({
      logFiles: ['log/development.log', 'prod-logs/sidekiq.log']
    });

    const result = await resolveProjectLogFile(
      projectPath,
      path.join(projectPath, 'prod-logs', 'sidekiq.log')
    );

    expect(result.success).toBe(true);
    expect(result.logPath).toBe(path.join(projectPath, 'prod-logs', 'sidekiq.log'));
    expect(result.logFileExists).toBe(true);
  });

  it('accepts log files outside of the project log directory', async () => {
    const projectPath = await createRailsProject({
      logFiles: ['log/development.log']
    });
    const externalDirectoryPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logspect-external-'));
    temporaryDirectories.push(externalDirectoryPath);
    const externalLogPath = path.join(externalDirectoryPath, 'prod.log');
    await fs.promises.writeFile(externalLogPath, 'external log\n');

    const result = await resolveProjectLogFile(projectPath, externalLogPath);

    expect(result.success).toBe(true);
    expect(result.logPath).toBe(externalLogPath);
    expect(result.availableLogFiles[0]).toMatchObject({
      path: externalLogPath,
      source: 'external',
      displayPath: externalLogPath
    });
  });

  it('rejects files without a .log extension', async () => {
    const projectPath = await createRailsProject({
      logFiles: ['log/development.log']
    });

    const result = await resolveProjectLogFile(projectPath, path.join(projectPath, 'tmp.txt'));

    expect(result.success).toBe(false);
    expect(result.message).toContain('.log');
  });
});
