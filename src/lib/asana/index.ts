/**
 * Asana module — Push approved UX issues as Asana tasks.
 *
 * Responsibilities:
 *  - Authenticate with Asana API
 *  - Create tasks from approved UX issues
 *  - Attach screenshot evidence and recommendations to each task
 */

export interface AsanaTaskPayload {
  name: string;
  notes: string;
  projectId: string;
  severity: string;
  attachments?: string[];
}
