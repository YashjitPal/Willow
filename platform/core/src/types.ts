import { LucideIcon } from 'lucide-react';

export type DashboardExperience = 'chat' | 'spark';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  active?: boolean;
}

export interface Project {
  id: string;
  title: string;
  thumbnail: string;
  lastViewed: string;
}

export enum SidebarSectionType {
  MAIN = 'MAIN',
  PROJECTS = 'PROJECTS',
  RESOURCES = 'RESOURCES'
}
