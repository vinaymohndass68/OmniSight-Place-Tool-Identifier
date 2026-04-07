
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { FoundItem } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const ANALYSIS_MODEL = 'gemini-3-flash-preview';
const PRO_MODEL = 'gemini-3-pro-preview';
const IMAGE_GEN_MODEL = 'gemini-2.5-flash-image';

/**
 * Simple concurrency controller to prevent hitting 429 Rate Limits
 * by sending too many requests at once.
 */
class RequestQueue {
  private queue: (() => Promise<any>)[] = [];
  private activeCount = 0;
  private maxConcurrent = 1;

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const task = async () => {
        this.activeCount++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeCount--;
          this.next();
        }
      };

      if (this.activeCount < this.maxConcurrent) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  }

  private next() {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const nextTask = this.queue.shift();
      if (nextTask) nextTask();
    }
  }
}

const imageQueue = new RequestQueue();

/**
 * Utility function to handle retries with exponential backoff for API calls.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 2000
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const status = error?.status || error?.error?.code;
      if (status === 429 || (status >= 500 && status < 600)) {
        const delay = initialDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const analyzePlaceByText = async (placeName: string): Promise<FoundItem[]> => {
  return retryWithBackoff(async () => {
    const prompt = `Identify 8-10 specific professional items, instruments, devices, or tools typically found in a ${placeName}. For each item, provide a name and a detailed description of its use.`;
    
    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              category: { type: Type.STRING }
            },
            required: ["name", "description", "category"]
          }
        }
      }
    });

    const jsonStr = response.text || "[]";
    const items = JSON.parse(jsonStr).map((item: any, index: number) => ({
      ...item,
      id: `text-${index}-${Date.now()}`
    }));

    return items;
  });
};

export const fetchAdditionalItems = async (placeName: string, existingItems: string[]): Promise<FoundItem[]> => {
  return retryWithBackoff(async () => {
    const prompt = `I already have a list of common items for a ${placeName}: [${existingItems.join(', ')}]. 
    Now, think deeply and identify 5-8 more specialized, advanced, rare, or niche professional tools/instruments found here that were NOT in the previous list. 
    Provide high-quality technical descriptions for each.`;

    const response = await ai.models.generateContent({
      model: PRO_MODEL,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 32768 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              category: { type: Type.STRING }
            },
            required: ["name", "description", "category"]
          }
        }
      }
    });

    const jsonStr = response.text || "[]";
    const items = JSON.parse(jsonStr).map((item: any, index: number) => ({
      ...item,
      id: `pro-${index}-${Date.now()}`
    }));

    return items;
  });
};

export const analyzePlaceByImage = async (base64Image: string): Promise<FoundItem[]> => {
  return retryWithBackoff(async () => {
    const prompt = `Analyze this photo of a scene. Identify specific professional items, devices, or instruments visible. 
    For each item, return its name, description, category, and a bounding box [ymin, xmin, ymax, xmax] normalized from 0 to 1000 where 0 is the top/left and 1000 is the bottom/right of the image.`;
    
    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              category: { type: Type.STRING },
              boundingBox: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
                description: "[ymin, xmin, ymax, xmax]"
              }
            },
            required: ["name", "description", "category", "boundingBox"]
          }
        }
      }
    });

    const jsonStr = response.text || "[]";
    const items = JSON.parse(jsonStr).map((item: any, index: number) => ({
      ...item,
      id: `img-${index}-${Date.now()}`
    }));

    return items;
  });
};

export const generateItemImage = async (itemName: string, placeName: string): Promise<string> => {
  return imageQueue.add(async () => {
    try {
      return await retryWithBackoff(async () => {
        const prompt = `A professional, high-quality studio photograph of a ${itemName} found in a ${placeName}. Clean white background, ultra-realistic, sharp focus, technical style.`;
        
        const response = await ai.models.generateContent({
          model: IMAGE_GEN_MODEL,
          contents: {
            parts: [{ text: prompt }]
          },
          config: {
            imageConfig: {
              aspectRatio: "1:1"
            }
          }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
        
        return `https://picsum.photos/seed/${encodeURIComponent(itemName)}/400/400`;
      });
    } catch (error: any) {
      console.warn("Image generation failed:", error.message || error);
      return `https://picsum.photos/seed/${encodeURIComponent(itemName)}/400/400`;
    }
  });
};
