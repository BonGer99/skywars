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
  playerSkillLevel: z.string().describe('The skill level of the player (e.g., beginner, intermediate, advanced).'),
});
export type OpponentBehaviorInput = z.infer<typeof OpponentBehaviorInputSchema>;

const OpponentBehaviorOutputSchema = z.object({
  attackPattern: z.string().describe('The attack pattern of the AI opponent (e.g., aggressive, defensive, erratic).'),
  evasionTactics: z.string().describe('The evasion tactics used by the AI opponent (e.g., barrel rolls, loop-the-loops, dives).'),
  difficultyLevel: z.string().describe('The overall difficulty level of the AI opponent (e.g., easy, medium, hard).'),
});
export type OpponentBehaviorOutput = z.infer<typeof OpponentBehaviorOutputSchema>;

export async function generateOpponentBehavior(input: OpponentBehaviorInput): Promise<OpponentBehaviorOutput> {
  return opponentBehaviorFlow(input);
}

const prompt = ai.definePrompt({
  name: 'opponentBehaviorPrompt',
  input: {schema: OpponentBehaviorInputSchema},
  output: {schema: OpponentBehaviorOutputSchema},
  prompt: `You are an expert game AI designer specializing in creating challenging and engaging AI opponents for arcade flight combat games.

You will use the wave number and player skill level to determine the attack pattern, evasion tactics, and overall difficulty level of the AI opponent.

As the wave number increases, the AI opponent should become more aggressive and use more advanced evasion tactics.

Consider these wave number to difficulty level:

Wave 1-3: Easy
Wave 4-6: Medium
Wave 7-9: Hard
Wave 10+: Very Hard

Player skill level: {{{playerSkillLevel}}}
Wave number: {{{waveNumber}}}

Based on the wave number and player skill level, generate the AI opponent's behavior.

Attack pattern:
Evasion tactics:
Difficulty level:`,
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
