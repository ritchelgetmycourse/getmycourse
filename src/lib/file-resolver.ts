import fs from 'fs/promises';
import path from 'path';

/**
 * Production-grade file resolver that works in both local and serverless environments.
 * 
 * In Next.js/Vercel:
 * - Local: process.cwd() points to project root
 * - Vercel: process.cwd() points to /var/task (project root)
 * 
 * This resolver normalizes relative paths relative to the project root,
 * making file resolution consistent across environments.
 */

class FileResolver {
    private projectRoot: string;

    constructor() {
        // process.cwd() is reliable in both local and Vercel environments
        this.projectRoot = process.cwd();
    }

    /**
     * Resolves a relative file path to an absolute path within the project
     * @param relativePath - Path relative to project root (e.g., "schemas/CHC30121.json")
     * @returns Absolute file path
     */
    private resolvePath(relativePath: string): string {
        return path.resolve(this.projectRoot, relativePath);
    }

    /**
     * Reads a file and returns its content as a string
     * @param relativePath - Path relative to project root
     * @returns File content as string
     * @throws Error if file cannot be read
     */
    async readFile(relativePath: string): Promise<string> {
        const absolutePath = this.resolvePath(relativePath);

        try {
            const content = await fs.readFile(absolutePath, 'utf-8');
            return content;
        } catch (error) {
            if (error instanceof Error) {
                if ('code' in error && error.code === 'ENOENT') {
                    throw new Error(
                        `File not found: ${relativePath} (resolved to ${absolutePath})`
                    );
                }
                throw new Error(`Failed to read file ${relativePath}: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Reads a JSON file and parses it
     * @param relativePath - Path relative to project root
     * @returns Parsed JSON object
     * @throws Error if file cannot be read or JSON is invalid
     */
    async readJSON<T = any>(relativePath: string): Promise<T> {
        const content = await this.readFile(relativePath);
        try {
            return JSON.parse(content);
        } catch (error) {
            throw new Error(
                `Invalid JSON in file ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Checks if a file exists
     * @param relativePath - Path relative to project root
     * @returns true if file exists, false otherwise
     */
    async fileExists(relativePath: string): Promise<boolean> {
        const absolutePath = this.resolvePath(relativePath);
        try {
            await fs.access(absolutePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Gets the absolute path for a relative path (useful for debugging)
     * @param relativePath - Path relative to project root
     * @returns Absolute file path
     */
    getAbsolutePath(relativePath: string): string {
        return this.resolvePath(relativePath);
    }
}

// Export singleton instance
export const fileResolver = new FileResolver();
