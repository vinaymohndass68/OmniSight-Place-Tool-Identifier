
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Search, Image as ImageIcon, Sparkles, MapPin, Trash2, FileDown, Loader2, BrainCircuit, Plus, X, CameraIcon, RefreshCcw, ScanLine, Play, Pause, Target, ZoomIn } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { FoundItem, AppState } from './types';
import { analyzePlaceByText, analyzePlaceByImage, generateItemImage, fetchAdditionalItems } from './services/geminiService';
import ItemCard from './components/ItemCard';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    items: [],
    isLoading: false,
    error: null,
    currentPlace: ''
  });
  
  const [searchInput, setSearchInput] = useState('');
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isThinkingHarder, setIsThinkingHarder] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isLiveScanning, setIsLiveScanning] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [tapTarget, setTapTarget] = useState<{x: number, y: number} | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleTextSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchInput.trim()) return;

    setState(prev => ({ ...prev, isLoading: true, error: null, currentPlace: searchInput }));
    setPreviewImage(null);
    
    try {
      const items = await analyzePlaceByText(searchInput);
      setState(prev => ({ ...prev, items, isLoading: false }));
    } catch (err: any) {
      setState(prev => ({ ...prev, isLoading: false, error: err.message || 'Failed to analyze place' }));
    }
  };

  const startCamera = async () => {
    setIsCameraOpen(true);
    setZoomLevel(1);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }, 
        audio: false 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      setState(prev => ({ ...prev, error: "Could not access camera. Please check permissions." }));
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
    setIsLiveScanning(false);
    if (scanIntervalRef.current) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  };

  const cropImageFromBox = (canvas: HTMLCanvasElement, box: [number, number, number, number]): string => {
    const [ymin, xmin, ymax, xmax] = box;
    const width = canvas.width;
    const height = canvas.height;

    const left = (xmin / 1000) * width;
    const top = (ymin / 1000) * height;
    const right = (xmax / 1000) * width;
    const bottom = (ymax / 1000) * height;

    const cropWidth = right - left;
    const cropHeight = bottom - top;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
    const cropCtx = cropCanvas.getContext('2d');

    if (cropCtx) {
      cropCtx.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return cropCanvas.toDataURL('image/jpeg', 0.8);
    }
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const handleVideoTap = async (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!videoRef.current || isProcessingScan) return;
    
    const rect = videoRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setTapTarget({ x, y });
    setTimeout(() => setTapTarget(null), 1500);

    // Zoom and Capture
    setIsProcessingScan(true);
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      
      // Focus identification: Crop a 40% region around the tap point
      const focusWidth = canvas.width * 0.4;
      const focusHeight = canvas.height * 0.4;
      const focusLeft = Math.max(0, (x/100 * canvas.width) - focusWidth/2);
      const focusTop = Math.max(0, (y/100 * canvas.height) - focusHeight/2);
      
      const focusCanvas = document.createElement('canvas');
      focusCanvas.width = focusWidth;
      focusCanvas.height = focusHeight;
      const focusCtx = focusCanvas.getContext('2d');
      if (focusCtx) {
        focusCtx.drawImage(canvas, focusLeft, focusTop, focusWidth, focusHeight, 0, 0, focusWidth, focusHeight);
        const focusBase64 = focusCanvas.toDataURL('image/jpeg', 0.9).split(',')[1];
        
        try {
          const newItems = await analyzePlaceByImage(focusBase64);
          const processedItems = newItems.map(item => ({
            ...item,
            imageUrl: focusCanvas.toDataURL('image/jpeg', 0.8)
          }));
          
          setState(prev => {
            const existingNames = new Set(prev.items.map(i => i.name.toLowerCase()));
            const uniqueNewItems = processedItems.filter(item => !existingNames.has(item.name.toLowerCase()));
            return {
              ...prev,
              items: [...prev.items, ...uniqueNewItems]
            };
          });
        } catch (err) {
          console.error("Tap focus failed:", err);
        } finally {
          setIsProcessingScan(false);
        }
      }
    }
  };

  const captureFrameForAnalysis = useCallback(async () => {
    if (!videoRef.current || isProcessingScan) return;

    setIsProcessingScan(true);
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      
      try {
        const detectedItems = await analyzePlaceByImage(base64);
        
        setState(prev => {
          const existingNames = new Set(prev.items.map(i => i.name.toLowerCase()));
          const uniqueNewItems = detectedItems
            .filter(item => !existingNames.has(item.name.toLowerCase()))
            .map(item => ({
              ...item,
              imageUrl: item.boundingBox ? cropImageFromBox(canvas, item.boundingBox) : canvas.toDataURL('image/jpeg', 0.8)
            }));
          
          if (uniqueNewItems.length === 0) return prev;
          
          return {
            ...prev,
            items: [...prev.items, ...uniqueNewItems],
            currentPlace: prev.currentPlace || 'Analyzed Scene'
          };
        });
      } catch (err) {
        console.error("Scan analysis failed:", err);
      } finally {
        setIsProcessingScan(false);
      }
    }
  }, [isProcessingScan]);

  useEffect(() => {
    if (isLiveScanning && isCameraOpen) {
      scanIntervalRef.current = window.setInterval(() => {
        captureFrameForAnalysis();
      }, 5000);
    } else {
      if (scanIntervalRef.current) {
        window.clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    }

    return () => {
      if (scanIntervalRef.current) window.clearInterval(scanIntervalRef.current);
    };
  }, [isLiveScanning, isCameraOpen, captureFrameForAnalysis]);

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      setPreviewImage(dataUrl);
      const base64 = dataUrl.split(',')[1];
      stopCamera();
      processImageAnalysis(base64, canvas);
    }
  };

  const processImageAnalysis = async (base64: string, fullCanvas?: HTMLCanvasElement) => {
    setState(prev => ({ ...prev, isLoading: true, error: null, currentPlace: prev.currentPlace || 'Visual Scene' }));
    try {
      const items = await analyzePlaceByImage(base64);
      setState(prev => {
        const existingNames = new Set(prev.items.map(i => i.name.toLowerCase()));
        const uniqueNewItems = items
          .filter(item => !existingNames.has(item.name.toLowerCase()))
          .map(item => ({
            ...item,
            imageUrl: (item.boundingBox && fullCanvas) 
              ? cropImageFromBox(fullCanvas, item.boundingBox) 
              : (fullCanvas?.toDataURL('image/jpeg', 0.8))
          }));
        return { 
          ...prev, 
          items: [...prev.items, ...uniqueNewItems], 
          isLoading: false 
        };
      });
    } catch (err: any) {
      setState(prev => ({ ...prev, isLoading: false, error: err.message || 'Failed to analyze image' }));
    }
  };

  const handleDiscoverMore = async () => {
    if (!state.currentPlace || isThinkingHarder) return;

    setIsThinkingHarder(true);
    const existingNames = state.items.map(item => item.name);

    try {
      const additionalItems = await fetchAdditionalItems(state.currentPlace, existingNames);
      setState(prev => ({
        ...prev,
        items: [...prev.items, ...additionalItems]
      }));
    } catch (err: any) {
      console.error("Discovery error:", err);
    } finally {
      setIsThinkingHarder(false);
    }
  };

  const handleRemoveItem = (id: string) => {
    setState(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id)
    }));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setPreviewImage(dataUrl);
      
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          processImageAnalysis(base64, canvas);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const downloadPDF = async () => {
    if (state.items.length === 0) return;
    
    setIsGeneratingPDF(true);
    const doc = new jsPDF();
    const margin = 20;
    let y = 20;

    doc.setFontSize(22);
    doc.setTextColor(15, 23, 42); 
    doc.text(`OmniSight Catalog`, margin, y);
    y += 10;

    doc.setFontSize(16);
    doc.setTextColor(37, 99, 235); 
    doc.text(`Place: ${state.currentPlace}`, margin, y);
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, margin, y);
    y += 5;

    doc.setDrawColor(200);
    doc.line(margin, y, 190, y);
    y += 15;

    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      if (y > 230) {
        doc.addPage();
        y = 20;
      }

      let imgData = item.imageUrl || "";
      if (!imgData) {
        try {
          imgData = await generateItemImage(item.name, state.currentPlace);
        } catch (e) {
          console.error("Failed to fetch image for PDF", e);
        }
      }

      if (imgData && imgData.startsWith('data:image')) {
        try {
          doc.addImage(imgData, 'PNG', margin, y, 40, 40);
        } catch (e) {
          console.error("PDF Image Add Error", e);
        }
      }

      const textLeftMargin = margin + 45;
      doc.setFontSize(14);
      doc.setTextColor(30, 64, 175);
      doc.setFont('helvetica', 'bold');
      doc.text(`${item.name}`, textLeftMargin, y + 5);
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.setFont('helvetica', 'italic');
      doc.text(`Category: ${item.category}`, textLeftMargin, y + 12);

      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'normal');
      const splitText = doc.splitTextToSize(item.description, 125);
      doc.text(splitText, textLeftMargin, y + 20);
      
      const textHeight = (splitText.length * 5) + 20;
      y += Math.max(50, textHeight);
      
      doc.setDrawColor(245);
      doc.line(margin, y - 5, 190, y - 5);
      y += 5;
    }

    doc.save(`OmniSight_${state.currentPlace.replace(/\s+/g, '_')}.pdf`);
    setIsGeneratingPDF(false);
  };

  const handleStartOver = () => {
    setState({
      items: [],
      isLoading: false,
      error: null,
      currentPlace: ''
    });
    setSearchInput('');
    setPreviewImage(null);
    stopCamera();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20">
      <nav className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={handleStartOver}>
            <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-cyan-400 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles className="text-white w-6 h-6" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">OmniSight</span>
          </div>
          
          <div className="flex items-center gap-4 md:gap-6">
            <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
              <a href="#" className="hover:text-white transition-colors">Explorer</a>
              <a href="#" className="hover:text-white transition-colors">History</a>
            </div>
            {state.items.length > 0 && (
              <button 
                onClick={handleStartOver}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-all bg-slate-800/50 rounded-lg border border-slate-700 hover:border-slate-500"
              >
                <RefreshCcw className="w-3 h-3" />
                Start Over
              </button>
            )}
          </div>
        </div>
      </nav>

      <header className={`relative transition-all duration-500 ${state.items.length > 0 ? 'pt-8 pb-12' : 'pt-16 pb-20'} overflow-hidden`}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-blue-600/10 blur-[120px] pointer-events-none"></div>
        
        <div className="max-w-4xl mx-auto px-6 text-center">
          {state.items.length === 0 && (
            <>
              <h1 className="text-5xl md:text-6xl font-extrabold mb-6 tracking-tight leading-tight">
                Discover What's <br />
                <span className="text-blue-500">Inside Any Space.</span>
              </h1>
              <p className="text-lg text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                Instantly identify professional tools, medical devices, or specialized equipment. 
                Search by place name or upload a visual scene.
              </p>
            </>
          )}

          <div className="flex flex-col md:flex-row items-center gap-4 bg-slate-900/50 p-2 rounded-2xl border border-slate-800 shadow-2xl backdrop-blur-sm">
            <form onSubmit={handleTextSearch} className="flex-grow flex items-center w-full">
              <div className="pl-4 text-slate-500">
                <MapPin className="w-5 h-5" />
              </div>
              <input 
                type="text" 
                placeholder="e.g. Modern Dental Clinic, Server Room, Lab..." 
                className="bg-transparent border-none focus:ring-0 text-slate-100 placeholder-slate-600 px-4 py-3 flex-grow outline-none"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button 
                type="submit"
                disabled={state.isLoading}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-600/20 mr-1"
              >
                {state.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Analyze
              </button>
            </form>
            
            <div className="w-px h-10 bg-slate-800 hidden md:block"></div>
            
            <div className="flex gap-2 w-full md:w-auto">
              <button 
                onClick={startCamera}
                className="flex-1 md:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/20 rounded-xl font-semibold transition-all active:scale-95"
              >
                <Camera className="w-5 h-5" />
                Live Camera
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 md:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold transition-all active:scale-95"
              >
                <ImageIcon className="w-5 h-5" />
                Upload
              </button>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*"
              onChange={handleImageUpload}
            />
          </div>
        </div>
      </header>

      {/* Camera Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h3 className="font-bold flex items-center gap-2">
                  <CameraIcon className="w-5 h-5 text-blue-500" />
                  Targeted Insight
                </h3>
                {isLiveScanning && (
                  <div className="flex items-center gap-2 px-2 py-1 bg-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest rounded border border-blue-500/30">
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
                    Scanning Environment
                  </div>
                )}
              </div>
              <button onClick={stopCamera} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                onClick={handleVideoTap}
                style={{ transform: `scale(${zoomLevel})` }}
                className="w-full h-full object-cover cursor-crosshair transition-transform duration-300"
              />
              
              {/* Tap Target UI */}
              {tapTarget && (
                <div 
                  className="absolute z-10 pointer-events-none"
                  style={{ left: `${tapTarget.x}%`, top: `${tapTarget.y}%` }}
                >
                  <div className="w-20 h-20 -translate-x-1/2 -translate-y-1/2 border-2 border-blue-500 rounded-full animate-ping"></div>
                  <div className="w-8 h-8 -translate-x-1/2 -translate-y-1/2 border-2 border-white rounded-full flex items-center justify-center">
                    <div className="w-1 h-1 bg-white rounded-full"></div>
                  </div>
                  <div className="absolute top-10 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-blue-400 bg-slate-950/80 px-2 py-0.5 rounded">
                    FOCUSING AREA...
                  </div>
                </div>
              )}

              {/* Scan HUD Overlay */}
              <div className="absolute inset-0 pointer-events-none">
                 <div className="absolute inset-0 border-[30px] border-slate-950/40"></div>
                 <div className="w-full h-full border-2 border-white/10 border-dashed rounded-lg flex items-center justify-center">
                    {isProcessingScan && (
                      <div className="absolute top-1/2 left-0 w-full h-0.5 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,1)] animate-scan-line"></div>
                    )}
                 </div>
              </div>

              {/* Status Indicator */}
              {isProcessingScan && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-900/90 backdrop-blur-md px-4 py-2 rounded-full border border-blue-500/30 text-xs font-bold text-blue-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  ANALYZING CROPPED REGIONS...
                </div>
              )}
            </div>

            <div className="p-6 bg-slate-900/50 backdrop-blur-xl border-t border-slate-800 flex flex-col items-center gap-6">
              <div className="flex items-center gap-4 w-full justify-between">
                <div className="flex items-center gap-2">
                   <button 
                    onClick={() => setIsLiveScanning(!isLiveScanning)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all ${
                      isLiveScanning 
                      ? 'bg-amber-500/10 text-amber-500 border border-amber-500/30' 
                      : 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                    }`}
                  >
                    {isLiveScanning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    {isLiveScanning ? 'Auto Stop' : 'Auto Scan'}
                  </button>
                  <div className="w-px h-6 bg-slate-800"></div>
                  <div className="flex items-center gap-3 px-3 py-1 bg-slate-800/50 rounded-lg">
                    <ZoomIn className="w-3 h-3 text-slate-400" />
                    <input 
                      type="range" 
                      min="1" 
                      max="3" 
                      step="0.1" 
                      value={zoomLevel} 
                      onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
                      className="w-24 accent-blue-500"
                    />
                    <span className="text-[10px] font-bold text-slate-300 w-6">{zoomLevel.toFixed(1)}x</span>
                  </div>
                </div>

                <button 
                  onClick={capturePhoto}
                  className="group relative w-14 h-14 rounded-full bg-white flex items-center justify-center transition-all active:scale-90 shadow-xl shadow-white/10"
                >
                  <div className="absolute inset-0 rounded-full border-4 border-slate-900/20 scale-90"></div>
                  <div className="w-10 h-10 rounded-full border-2 border-slate-900 group-hover:bg-slate-100 transition-colors"></div>
                </button>

                <div className="flex items-center gap-2">
                   <div className="text-right">
                    <p className="text-[10px] uppercase font-bold text-slate-500 tracking-tighter">Pro Tip</p>
                    <p className="text-[10px] text-slate-400">Tap screen to zoom identify</p>
                  </div>
                  <Target className="w-4 h-4 text-blue-500" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6">
        {state.isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-6">
            <div className="relative">
               <div className="w-20 h-20 border-4 border-blue-500/20 rounded-full"></div>
               <div className="absolute inset-0 w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div className="text-center">
              <h3 className="text-xl font-bold mb-2">Analyzing {state.currentPlace || 'Environment'}</h3>
              <p className="text-slate-400">Our AI is cataloging specialized instruments and devices...</p>
            </div>
          </div>
        ) : state.items.length > 0 ? (
          <div>
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-3xl font-bold">Catalog: {state.currentPlace}</h2>
                  <span className="px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-bold rounded-full border border-blue-500/20">
                    {state.items.length} ITEMS IDENTIFIED
                  </span>
                </div>
                <p className="text-slate-400">Detailed list of professional equipment typically found here.</p>
              </div>
              
              <div className="flex items-center gap-3">
                <button 
                  onClick={downloadPDF}
                  disabled={isGeneratingPDF}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg text-sm font-semibold transition-all border border-emerald-500/20 disabled:opacity-50"
                >
                  {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                  {isGeneratingPDF ? 'Packaging...' : 'Download PDF'}
                </button>
                <button 
                  onClick={handleStartOver}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg text-sm font-semibold transition-all border border-slate-700"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Start Over
                </button>
              </div>
            </div>

            {previewImage && !isCameraOpen && (
              <div className="mb-12 rounded-3xl overflow-hidden relative group max-w-md mx-auto border border-slate-800 shadow-2xl">
                <img src={previewImage} alt="Input source" className="w-full h-64 object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent flex items-end p-6">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-blue-400" />
                    <span className="text-sm font-semibold">Base Analysis Frame</span>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
              {state.items.map((item) => (
                <ItemCard 
                  key={item.id} 
                  item={item} 
                  placeContext={state.currentPlace} 
                  onRemove={handleRemoveItem}
                />
              ))}

              {!isCameraOpen && (
                <div className="relative group">
                  <button 
                    onClick={handleDiscoverMore}
                    disabled={isThinkingHarder}
                    className="w-full h-full min-h-[400px] rounded-2xl border-2 border-dashed border-slate-800 bg-slate-900/20 hover:bg-slate-900/40 hover:border-blue-500/50 transition-all flex flex-col items-center justify-center p-8 text-center disabled:opacity-50 disabled:cursor-wait"
                  >
                    {isThinkingHarder ? (
                      <>
                        <div className="w-16 h-16 mb-6 relative">
                          <BrainCircuit className="w-full h-full text-blue-500 animate-pulse" />
                          <div className="absolute inset-0 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                        </div>
                        <h4 className="text-lg font-bold text-blue-400 mb-2">Deep Thinking...</h4>
                        <p className="text-slate-500 text-sm">Gemini 3 Pro is identifying specialized & niche professional items.</p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-6 group-hover:bg-blue-500/10 group-hover:text-blue-400 transition-all">
                          <Plus className="w-8 h-8" />
                        </div>
                        <h4 className="text-lg font-bold text-white mb-2">Discover More</h4>
                        <p className="text-slate-500 text-sm mb-6">Ask Gemini to think harder and find niche or advanced tools not listed here.</p>
                        <span className="px-4 py-2 bg-blue-600/10 text-blue-400 rounded-full text-xs font-bold border border-blue-500/20">
                          POWERED BY GEMINI 3 PRO
                        </span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          !state.isLoading && !state.error && (
            <div className="py-20 text-center flex flex-col items-center">
              <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center mb-6 border border-slate-800">
                <Search className="w-10 h-10 text-slate-700" />
              </div>
              <h2 className="text-2xl font-bold mb-2">No items listed yet</h2>
              <p className="text-slate-500 max-w-sm">Enter a place name above, snap a live photo, or upload a workplace scene to reveal the technical world inside.</p>
            </div>
          )
        )}

        {state.error && (
          <div className="mt-8 p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-center max-w-2xl mx-auto">
            <p className="text-red-400 font-medium mb-4">{state.error}</p>
            <div className="flex items-center justify-center gap-4">
              <button 
                onClick={() => setState(prev => ({ ...prev, error: null }))}
                className="px-6 py-2 bg-red-500 text-white rounded-xl text-sm font-bold"
              >
                Try Again
              </button>
              <button 
                onClick={handleStartOver}
                className="px-6 py-2 bg-slate-800 text-slate-300 rounded-xl text-sm font-bold border border-slate-700"
              >
                Reset App
              </button>
            </div>
          </div>
        )}
      </main>

      {state.items.length === 0 && !state.isLoading && !isCameraOpen && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-white text-slate-950 px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-bounce cursor-pointer hover:scale-105 transition-transform">
          <Sparkles className="w-5 h-5 text-blue-600" />
          <span className="font-bold text-sm">Start by typing "Hospital Lab"</span>
        </div>
      )}
    </div>
  );
};

export default App;
