// ============================================================================
// DEFAULT MODELS - Quick Reference for Developers
// ============================================================================
// This file contains model names used by the system internally.
// Modify these values to quickly switch models without hunting through the codebase.
// 
// NOTE: This file only defines model NAMES. Actual model configurations
// (system prompts, thinking levels, etc.) are in their respective lib files.
// ============================================================================

// -----------------------------------------------------------------------------
// COMPUTER USE TESTING
// -----------------------------------------------------------------------------

// Model for the actual computer use testing (clicking, typing, screenshots)
// Uses Gemini's Computer Use API for interacting with web applications
export const COMPUTER_USE_MODEL = 'gemini-2.5-computer-use-preview-10-2025';

// Model for generating the intro paragraph before testing starts
// Uses a fast, lightweight model for quick text generation
export const TEST_INTRO_MODEL = 'gemini-2.5-flash-lite';
