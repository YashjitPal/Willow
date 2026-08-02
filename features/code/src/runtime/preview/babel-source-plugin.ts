import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

/**
 * Babel plugin to inject source location data into JSX elements
 * Adds data-willow-source="fileName:line:column" attribute to all JSX opening elements
 * Also tracks imported components and adds data-willow-component for better file navigation
 */

export interface SourceLocationCache {
  hash: string;
  augmentedCode: string;
  imports: Record<string, string>; // Maps component name to file path
}

// Simple in-memory cache for parsed results
const sourceLocationCache = new Map<string, SourceLocationCache>();

/**
 * Simple hash function for caching
 */
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

/**
 * Extract import information from code
 * Maps component names to their source files
 */
function extractImports(ast: any): Record<string, string> {
  const imports: Record<string, string> = {};

  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;

      for (const specifier of path.node.specifiers) {
        // Handle: import Button from './Button'
        if (t.isImportDefaultSpecifier(specifier)) {
          const name = specifier.local.name;
          imports[name] = source;
        }
        // Handle: import { Button } from './components'
        else if (t.isImportSpecifier(specifier)) {
          const name = specifier.local.name;
          imports[name] = source;
        }
      }
    },
  });

  return imports;
}

/**
 * Get the name of a JSX element (e.g., "Button" from <Button>, or "div" from <div>)
 */
function getJSXElementName(node: any): string | null {
  if (t.isJSXIdentifier(node.name)) {
    return node.name.name;
  } else if (t.isJSXMemberExpression(node.name)) {
    // Handle: <React.Fragment>, <components.Button>, etc.
    return null; // Skip member expressions for now
  }
  return null;
}

/**
 * Inject source location metadata into all JSX elements
 * @param code - The JSX/TSX source code
 * @param fileName - The file name to include in the metadata (e.g., "App.tsx")
 * @returns Augmented code with data-willow-source attributes
 */
export function injectSourceLocations(code: string, fileName: string): string {
  // Check cache
  const cachedHash = hashCode(code);
  const cached = sourceLocationCache.get(fileName);
  if (cached && cached.hash === cachedHash) {
    return cached.augmentedCode;
  }

  try {
    // Parse the code to AST
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true, // Don't throw on parse errors, try to recover
    });

    // ✨ NEW: Extract import information
    const imports = extractImports(ast);

    // Traverse and transform JSX elements
    traverse(ast, {
      JSXOpeningElement(path) {
        const node = path.node;

        // Skip if already has data-willow-source (avoid duplication)
        const hasSource = node.attributes.some(
          (attr) =>
            t.isJSXAttribute(attr) &&
            t.isJSXIdentifier(attr.name) &&
            attr.name.name === 'data-willow-source'
        );
        if (hasSource) return;

        // Skip if no location info
        if (!node.loc) return;

        // Create the source location string: "fileName:line:column"
        const sourceValue = `${fileName}:${node.loc.start.line}:${node.loc.start.column}`;

        // Create the JSX attribute for source location
        const sourceAttr = t.jsxAttribute(
          t.jsxIdentifier('data-willow-source'),
          t.stringLiteral(sourceValue)
        );

        // Add to the element's attributes
        node.attributes.push(sourceAttr);

        // ✨ NEW: Add component file tracking if this is an imported component
        const elementName = getJSXElementName(node);
        if (elementName && imports[elementName]) {
          const componentFile = imports[elementName];
          const componentAttr = t.jsxAttribute(
            t.jsxIdentifier('data-willow-component'),
            t.stringLiteral(`${componentFile}:${elementName}`)
          );
          node.attributes.push(componentAttr);
        }
      },
    });

    // Generate code from modified AST
    const output = generate(ast, {
      retainLines: true, // Preserve original line numbers
      compact: false,
    });

    const augmentedCode = output.code;

    // Update cache
    sourceLocationCache.set(fileName, {
      hash: cachedHash,
      augmentedCode,
      imports,
    });

    return augmentedCode;
  } catch (error) {
    // Log error and return original code as fallback
    console.warn('[BabelSourcePlugin] Transform failed:', error);
    return code;
  }
}

/**
 * Clear the source location cache
 * Useful for hot reload scenarios
 */
export function clearSourceLocationCache(): void {
  sourceLocationCache.clear();
}

/**
 * Get cache size (for debugging)
 */
export function getSourceLocationCacheSize(): number {
  return sourceLocationCache.size;
}
