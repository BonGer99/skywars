// Implemented Genkit flow for AI-controlled enemy planes with adaptive behaviors in survival mode.

'use server';

/**
 * @fileOverview AI opponent behavior flow.
 *
 * - generateOpponentBehavior - A function that generates the AI opponent behavior.
 * - OpponentBehaviorInput - The input type for the generateOpponentBehavior function.
 * - OpponentBehaviorOutput - The return type for the generateOpponentBehavior function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const OpponentBehaviorInputSchema = z.object({
  waveNumber: z.number().describe('The current wave number in the survival mode.'),
  playerSkillLevel: z.number().describe('A number from 1 to 100, where 100 is highly skilled.'),
});
export type OpponentBehaviorInput = z.infer<typeof OpponentBehaviorInputSchema>;

const OpponentBehaviorOutputSchema = z.object({
  attackPattern: z.string().describe('The attack pattern of the AI opponent (e.g., "head-on," "strafing runs," "tailing").'),
  evasionTactics: z.string().describe('The evasion tactics used by the AI opponent (e.g., "none," "basic weave," "barrel rolls," "hard break").'),
  difficultyLevel: z.string().describe('The overall difficulty level of the AI opponent (e.g., "easy," "medium," "hard").'),
});
export type OpponentBehaviorOutput = z.infer<typeof OpponentBehaviorOutputSchema>;

export async function generateOpponentBehavior(input: OpponentBehaviorInput): Promise<OpponentBehaviorOutput> {
  return opponentBehaviorFlow(input);
}

const prompt = ai.definePrompt({
  name: 'opponentBehaviorPrompt',
  input: {schema: OpponentBehaviorInputSchema},
  output: {schema: OpponentBehaviorOutputSchema},
  prompt: `You are an expert game AI designer. Generate AI opponent behavior for an arcade flight combat game based on the following inputs:

- Wave Number: {{{waveNumber}}}
- Player Skill Rating: {{{playerSkillLevel}}} (A number from 1 to 100, where 100 is highly skilled)

A higher skill rating should result in more aggressive attack patterns and more complex evasion tactics. A lower skill rating should result in more predictable patterns.

Generate the following behavior properties:
- attackPattern: (e.g., "head-on," "strafing runs," "tailing")
- evasionTactics: (e.g., "none," "basic weave," "barrel rolls," "hard break")
- difficultyLevel: (e.g., "easy," "medium," "hard")`,
});

const opponentBehaviorFlow = ai.defineFlow(
  {
    name: 'opponentBehaviorFlow',
    inputSchema: OpponentBehaviorInputSchema,
    outputSchema: OpponentBehaviorOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
