"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type ProjectBoardContextType = {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  priorityFilter: string | null;
  setPriorityFilter: (priority: string | null) => void;
  assigneeFilter: string | null;
  setAssigneeFilter: (userId: string | null) => void;
  newTaskSignal: { column: string; count: number };
  triggerNewTask: (column?: string) => void;
  viewMode: "kanban" | "list" | "calendar";
  setViewMode: (mode: "kanban" | "list" | "calendar") => void;
};

const ProjectBoardContext = createContext<ProjectBoardContextType | null>(null);

export function ProjectBoardProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [newTaskSignal, setNewTaskSignal] = useState<{ column: string; count: number }>({
    column: "TODO",
    count: 0,
  });
  const [viewMode, setViewMode] = useState<"kanban" | "list" | "calendar">("kanban");

  function triggerNewTask(column: string = "TODO") {
    setNewTaskSignal((prev) => ({
      column,
      count: prev.count + 1,
    }));
  }

  return (
    <ProjectBoardContext.Provider
      value={{
        searchQuery,
        setSearchQuery,
        priorityFilter,
        setPriorityFilter,
        assigneeFilter,
        setAssigneeFilter,
        newTaskSignal,
        triggerNewTask,
        viewMode,
        setViewMode,
      }}
    >
      {children}
    </ProjectBoardContext.Provider>
  );
}

export function useProjectBoard() {
  const context = useContext(ProjectBoardContext);
  return context;
}
