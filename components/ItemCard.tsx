
import React, { useState, useEffect } from 'react';
import { X, ImageIcon } from 'lucide-react';
import { FoundItem } from '../types';
import { generateItemImage } from '../services/geminiService';

interface ItemCardProps {
  item: FoundItem;
  placeContext: string;
  onRemove: (id: string) => void;
}

const ItemCard: React.FC<ItemCardProps> = ({ item, placeContext, onRemove }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(item.imageUrl || null);
  const [loadingImage, setLoadingImage] = useState(!item.imageUrl);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    // If we already have a direct image URL (from live scan/upload), don't generate one
    if (item.imageUrl) {
      setImageUrl(item.imageUrl);
      setLoadingImage(false);
      return;
    }

    let isMounted = true;
    const fetchImage = async () => {
      setLoadingImage(true);
      setImageError(false);
      try {
        const url = await generateItemImage(item.name, placeContext);
        if (isMounted) {
          setImageUrl(url);
          setLoadingImage(false);
        }
      } catch (err) {
        if (isMounted) {
          setImageError(true);
          setLoadingImage(false);
        }
      }
    };
    fetchImage();
    return () => { isMounted = false; };
  }, [item.imageUrl, item.name, placeContext]);

  return (
    <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl overflow-hidden border border-slate-700/50 transition-all hover:scale-[1.02] hover:shadow-2xl hover:shadow-blue-500/10 flex flex-col h-full group relative">
      {/* Remove Button */}
      <button 
        onClick={() => onRemove(item.id)}
        className="absolute top-2 right-2 z-10 p-1.5 bg-slate-900/80 text-slate-400 hover:text-red-400 rounded-full opacity-0 group-hover:opacity-100 transition-all border border-slate-700 hover:border-red-500/50"
        title="Remove item"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="relative aspect-square overflow-hidden bg-slate-900">
        {loadingImage ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : imageError || !imageUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-700 p-4 text-center">
            <ImageIcon className="w-10 h-10 mb-2 opacity-20" />
            <span className="text-[10px] uppercase tracking-tighter font-semibold opacity-40">Preview Unavailable</span>
          </div>
        ) : (
          <img 
            src={imageUrl} 
            alt={item.name} 
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            onError={() => setImageError(true)}
          />
        )}
        <div className="absolute top-3 left-3">
          <span className="px-2 py-1 text-[10px] uppercase font-bold tracking-wider bg-blue-600 text-white rounded-md shadow-lg">
            {item.category}
          </span>
        </div>
      </div>
      
      <div className="p-5 flex flex-col flex-grow">
        <h3 className="text-lg font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">
          {item.name}
        </h3>
        <p className="text-slate-400 text-sm leading-relaxed mb-4 flex-grow">
          {item.description}
        </p>
        <div className="pt-4 border-t border-slate-700/50 flex items-center justify-between">
          <span className="text-xs text-slate-500">Verified by Gemini AI</span>
          <button className="text-blue-400 hover:text-blue-300 text-xs font-semibold flex items-center gap-1 transition-all">
            LEARN MORE
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ItemCard;
