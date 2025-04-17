import OpenAI from "openai";
import { ThreadContextManager, ThreadContextData } from "./context-manager";
import { AiFollower } from "@shared/schema";

// OpenAI configuration remains unchanged
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Export the openai instance so it can be reused across modules
export { openai };

interface AIResponse {
  type: "like" | "comment" | "reply";
  content?: string;
  confidence: number;
}

interface AIBackground {
  background: string;
  interests: string[];
  communication_style: string;
  interaction_preferences: {
    likes: string[];
    dislikes: string[];
  };
}

export async function generateAIBackground(
  name: string,
  personality: string,
  customInstructions?: string
): Promise<AIBackground> {
  try {
    // Validate parameters to avoid the 'name.includes is not a function' error
    if (typeof name !== 'string') {
      console.error("[OpenAI] Invalid name parameter:", name);
      // Provide a fallback name if needed
      name = String(name || "AI Assistant");
    }
    
    if (typeof personality !== 'string') {
      console.error("[OpenAI] Invalid personality parameter:", personality);
      // Provide a fallback personality if needed
      personality = String(personality || "Friendly and helpful");
    }
    
    // Check if this is a variation that needs a dynamic name
    const isDynamicNaming = name.includes("Variation") || customInstructions?.includes("generate a unique character name");
    
    let systemPrompt = `You are a creative character developer. Your task is to create a detailed background for an AI social-media follower, responding in JSON format with the following structure:
      {
        "background": "A brief but engaging backstory",
        "interests": ["List of 3-5 specific interests"],
        "communication_style": "Description of how they communicate",
        "interaction_preferences": {
          "likes": ["3-4 specific things they tend to like in posts"],
          "dislikes": ["2-3 things they tend to dislike or avoid"]
        }
      }
      The JSON response should be consistent with the follower's name and personality description.`;
    
    // Add specific instruction for dynamic naming
    if (isDynamicNaming) {
      systemPrompt = `You are a creative character developer. Your task is to create a detailed background for an AI social-media follower, responding in JSON format with the following structure:
        {
          "background": "Name: [UNIQUE CHARACTER NAME HERE]\\n\\nA brief but engaging backstory",
          "interests": ["List of 3-5 specific interests"],
          "communication_style": "Description of how they communicate",
          "interaction_preferences": {
            "likes": ["3-4 specific things they tend to like in posts"],
            "dislikes": ["2-3 things they tend to dislike or avoid"]
          }
        }
        
        IMPORTANT: The first line of the background MUST start with "Name: " followed by a unique, creative name for this character. This MUST be followed by two line breaks before the actual background text.
        
        The name should be thematically related to but distinct from "${name.replace(" Variation", "")}". Create a name that reflects the personality but is original.
        
        The JSON response should be consistent with the personality description.`;
    }
    
    try {
      // Check if OpenAI API key is available
      if (!process.env.OPENAI_API_KEY) {
        console.warn("[OpenAI] Missing API key, using fallback background generation");
        throw new Error("OpenAI API key not configured");
      }
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `Please generate a JSON background for an AI follower named "${name}" with this personality: "${personality}"${
              customInstructions ? ` Additional instructions: ${customInstructions}` : ''
            }`,
          },
        ],
        response_format: { type: "json_object" },
      });

      if (!response.choices[0].message.content) {
        throw new Error("No content in response");
      }

      return JSON.parse(response.choices[0].message.content);
    } catch (apiError: any) {
      console.warn("[OpenAI] API error:", apiError.message);
      console.log("[OpenAI] Using fallback background generation");
      
      // Generate a fallback background based on name and personality
      const interests = personality.toLowerCase().includes("tech") 
        ? ["Technology", "Programming", "AI"]
        : personality.toLowerCase().includes("creative") 
          ? ["Art", "Design", "Writing"] 
          : ["Social media", "Community building", "Content creation"];
          
      const likes = ["Thoughtful discussions", "Original content", "Positive interactions"];
      const dislikes = ["Spam", "Negativity"];
      
      // Create a fallback background
      const fallbackBackground: AIBackground = {
        background: `${name} is an AI assistant who loves to engage with people online.`,
        interests,
        communication_style: `${name} communicates in a ${personality.toLowerCase()} manner.`,
        interaction_preferences: {
          likes,
          dislikes
        }
      };
      
      return fallbackBackground;
    }
  } catch (error: any) {
    console.error("[OpenAI] Error in generateAIBackground:", error);
    throw new Error("Failed to generate AI background: " + error.message);
  }
}

/**
 * Generates the tools information for the AI prompt based on the follower's equipped tools
 */
function generateToolsPrompt(follower?: AiFollower): string {
  if (!follower || !follower.tools || !follower.tools.equipped || follower.tools.equipped.length === 0) {
    return '';
  }

  // Filter only enabled tools
  const enabledTools = follower.tools.equipped.filter(tool => tool.enabled);
  if (enabledTools.length === 0) {
    return '';
  }

  // Generate tools description
  let toolsPrompt = `\nAVAILABLE TOOLS:
You have access to the following tools to help in your responses:`;

  // Add each enabled tool
  enabledTools.forEach(tool => {
    toolsPrompt += `\n- ${tool.name}: ${tool.description}`;
  });

  // Add calculator specific information if it's enabled
  if (enabledTools.some(tool => tool.id === 'calculator')) {
    toolsPrompt += `\n\nTo use the Calculator tool, include calculations in your response using this format:
[calc: 5+3*2] or [calculate: (10-5)/2]
The calculation will be automatically processed and the result will replace the expression in your final response.

CRUCIAL INSTRUCTION: When responding to ANY math-related question or discussion:
1. ALWAYS use the calculator tool for ALL calculations by enclosing expressions in [calc: ] tags
2. Include the full calculation in your tags, not just the answer
3. Format all math operations like this: "The answer is [calc: 5+3*2]" (which will display as "The answer is 11")
4. Even if the calculation seems simple (like 2+2), still use [calc: 2+2]
5. For complex expressions, use proper calculator syntax: [calc: (10-5)/2 + 3^2]
6. Never calculate manually - always delegate to the calculator tool

Math problems appear in many forms like:
- "What's 5 plus 3 times 2?"
- "Calculate the area of a circle with radius 5"
- "If I have 3 apples and get 2 more, how many do I have?"
- "What's 15% of 200?"
- "Solve for x: 2x + 5 = 15" 

This creates a better user experience, ensures accuracy, and demonstrates your tool capabilities.`;
  }

  // Add any custom instructions from the user
  if (follower.tools.customInstructions) {
    toolsPrompt += `\n\nCUSTOM TOOL INSTRUCTIONS:
${follower.tools.customInstructions}`;
  }

  return toolsPrompt;
}

export async function generateAIResponse(
  postContent: string,
  personality: string,
  previousMessage?: string,
  threadContext?: ThreadContextData,
  previousMessages?: string,
  follower?: AiFollower
): Promise<AIResponse> {
  try {
    const contextManager = ThreadContextManager.getInstance();

    // Build comprehensive conversation history
    let conversationHistory = "";
    if (threadContext) {
      // If we have detailed previous messages history, use that for richer context
      if (previousMessages) {
        conversationHistory = `Recent conversation history:
           ${previousMessages}
           
           Current message to respond to: "${postContent}"`;
      } else {
        // Otherwise use the basic thread context
        const depthAwareHistory = threadContext.threadDepth <= 3
          ? `Recent conversation history:
             Last message: "${threadContext.immediateContext}"
             Earlier message: "${threadContext.parentMessage}"
             Topic started with: "${threadContext.threadTopic || 'various topics'}"
  
             Current message to respond to: "${postContent}"`
          : `You're deep in a conversation thread. 
             Latest message: "${postContent}"
  
             Note: Given your personality, you might not remember exactly how this conversation started.`;
  
        conversationHistory = depthAwareHistory;
      }
    }

    // Generate tools prompt if the follower has any tools equipped
    const toolsPrompt = generateToolsPrompt(follower);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an AI social media follower with this personality: "${personality}".

            MEMORY AND CONVERSATION RULES:
            1. For threads up to 3 messages deep:
               - You should naturally recall and reference recent messages
               - How well you maintain context depends on your personality
               - Feel free to bring up points from recent messages if relevant

            2. Personality affects your memory:
               - If you're analytical/professional: Keep good track of conversation
               - If you're casual/distracted: You might mix up or forget details
               - If you're social/chatty: Jump between topics but can circle back

            3. Natural conversation flow:
               - Stay true to your personality traits
               - Reference recent messages naturally (don't force it)
               - It's okay to sometimes forget or misremember things
               - Let your personality guide how you maintain conversation threads
            
            CONVERSATION STATE:
            ${conversationHistory || "Starting a new conversation"}
            ${toolsPrompt}

            RESPONSE FORMAT:
            Reply in JSON:
            {
              "type": ${previousMessage ? '"reply"' : '"like" or "comment"'},
              "content": "your response",
              "confidence": number between 0 and 1
            }`
        },
        {
          role: "user",
          content: postContent,
        },
      ],
      response_format: { type: "json_object" },
    });

    if (!response.choices[0].message.content) {
      throw new Error("No content in response");
    }

    const result = JSON.parse(response.choices[0].message.content);
    return {
      type: previousMessage ? "reply" : result.type,
      content: result.content,
      confidence: Math.max(0, Math.min(1, result.confidence)),
    };
  } catch (error: any) {
    throw new Error("Failed to generate AI response: " + error.message);
  }
}