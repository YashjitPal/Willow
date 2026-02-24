// Simple file store using React context for AI-generated files
import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

export interface GeneratedFile {
  path: string;
  content: string;
}

interface FileStoreContextType {
  files: Map<string, GeneratedFile>;
  addFile: (path: string, content: string) => void;
  clearFiles: () => void;
  getFile: (path: string) => GeneratedFile | undefined;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  previewUrl: string | null;
  setPreviewUrl: (url: string | null) => void;
  isGenerating: boolean;
  setIsGenerating: (value: boolean) => void;
  generationStatus: string;
  setGenerationStatus: (status: string) => void;
}

const FileStoreContext = createContext<FileStoreContextType | null>(null);

export const FileStoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [files, setFiles] = useState<Map<string, GeneratedFile>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  const addFile = useCallback((path: string, content: string) => {
    setFiles(prev => {
      const newFiles = new Map(prev);
      newFiles.set(path, { path, content });
      return newFiles;
    });
    // Auto-select first file if none selected
    setSelectedFile(prev => prev ?? path);
  }, []);

  const clearFiles = useCallback(() => {
    setFiles(new Map());
    setSelectedFile(null);
  }, []);

  const getFile = useCallback((path: string) => files.get(path), [files]);

  const value = useMemo(() => ({
    files,
    addFile,
    clearFiles,
    getFile,
    selectedFile,
    setSelectedFile,
    previewUrl,
    setPreviewUrl,
    isGenerating,
    setIsGenerating,
    generationStatus,
    setGenerationStatus,
  }), [files, addFile, clearFiles, getFile, selectedFile, previewUrl, isGenerating, generationStatus]);

  return (
    <FileStoreContext.Provider value={value}>
      {children}
    </FileStoreContext.Provider>
  );
};

export const useFileStore = () => {
  const context = useContext(FileStoreContext);
  if (!context) {
    throw new Error('useFileStore must be used within a FileStoreProvider');
  }
  return context;
};

// Helper to parse boltArtifact/boltAction tags from AI response
export function parseAIResponse(response: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  
  // Match <boltAction type="file" filePath="...">content</boltAction>
  const fileActionRegex = /<boltAction\s+type="file"\s+filePath="([^"]+)">([\s\S]*?)<\/boltAction>/g;
  
  let match;
  while ((match = fileActionRegex.exec(response)) !== null) {
    const [, filePath, content] = match;
    files.push({ path: filePath, content: content.trim() });
  }
  
  return files;
}
