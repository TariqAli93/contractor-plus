import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CancelProjectBody,
  CreateProjectInput,
  ListProjectsQuery,
  Project,
  ProjectWithContract,
  UpdateProjectInput,
} from '@/types/project';
import type { Paginated } from '@/types/pagination';

export const projectsApi = {
  list: (query: ListProjectsQuery): Promise<Paginated<ProjectWithContract>> =>
    apiGet('/projects', { params: query }),

  get: (id: string): Promise<ProjectWithContract> => apiGet(`/projects/${id}`),

  create: (input: CreateProjectInput): Promise<Project> => apiPost('/projects', input),

  update: (id: string, input: UpdateProjectInput): Promise<Project> =>
    apiPatch(`/projects/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`/projects/${id}`),

  // Lifecycle actions — bodyless except /cancel
  start: (id: string): Promise<Project> => apiPost(`/projects/${id}/start`),
  pause: (id: string): Promise<Project> => apiPost(`/projects/${id}/pause`),
  resume: (id: string): Promise<Project> => apiPost(`/projects/${id}/resume`),
  complete: (id: string): Promise<Project> => apiPost(`/projects/${id}/complete`),
  cancel: (id: string, body: CancelProjectBody = {}): Promise<Project> =>
    apiPost(`/projects/${id}/cancel`, body),

  // Safe unlink from contract (reason recorded in the audit log).
  unlinkContract: (id: string, reason: string): Promise<Project> =>
    apiPost(`/projects/${id}/unlink-contract`, { reason }),
};
