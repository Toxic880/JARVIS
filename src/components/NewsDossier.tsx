import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NewsItem } from '../services/ExternalAPIs';

interface ArticleDisplay {
  article: NewsItem;
  index: number;
  state: 'entering' | 'focused' | 'aside' | 'zooming';
  style: React.CSSProperties;
}

interface NewsDossierProps {
  news: NewsItem[];
  isVisible: boolean;
  onClose: () => void;
  isSpeaking: boolean;
}

/**
 * JARVIS-CONTROLLED ANIMATED NEWS DISPLAY
 * 
 * Like Iron Man 2 Ivan Vanko research scene:
 * 1. Article slides in dramatically from off-screen
 * 2. Image zooms and pans as JARVIS analyzes
 * 3. Article shrinks and slides to corner stack
 * 4. Next article enters
 * 
 * Multiple articles visible - stacked newspaper style
 */
export const NewsDossier: React.FC<NewsDossierProps> = ({
  news,
  isVisible,
  onClose,
  isSpeaking,
}) => {
  const [displayedArticles, setDisplayedArticles] = useState<ArticleDisplay[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [imageZoom, setImageZoom] = useState({ x: 0, y: 0, scale: 1 });
  const [phase, setPhase] = useState<'idle' | 'entering' | 'analyzing' | 'moving'>('idle');
  const sequenceRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Calculate style for aside/stacked articles
  const getAsideStyle = useCallback((asideIndex: number, total: number): React.CSSProperties => {
    // Stack in bottom-left, like papers on a desk
    const baseX = -42;
    const baseY = 25;
    return {
      left: '50%',
      top: '50%',
      transform: `
        translate(-50%, -50%)
        translateX(${baseX + asideIndex * 4}vw) 
        translateY(${baseY - asideIndex * 3}vh) 
        scale(0.22) 
        rotate(${-12 + asideIndex * 4 + (Math.random() - 0.5) * 4}deg)
      `,
      opacity: 0.85,
      zIndex: 20 + asideIndex,
      transition: 'all 1s cubic-bezier(0.34, 1.56, 0.64, 1)',
      filter: 'brightness(0.8)',
    };
  }, []);

  // Style for focused/center article - BIG and prominent
  const getFocusedStyle = useCallback((): React.CSSProperties => ({
    left: '55%',
    top: '50%',
    transform: 'translate(-50%, -50%) scale(1) rotate(0deg)',
    opacity: 1,
    zIndex: 100,
    transition: 'all 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)',
    filter: 'brightness(1)',
  }), []);

  // Style for entering article - dramatic slide from right
  const getEnteringStyle = useCallback((): React.CSSProperties => ({
    left: '50%',
    top: '50%',
    transform: 'translate(100vw, -50%) scale(0.6) rotate(15deg)',
    opacity: 0,
    zIndex: 100,
    transition: 'all 0.1s',
  }), []);

  // Animate image pan/zoom - like JARVIS analyzing
  const animateImage = useCallback(() => {
    let frame = 0;
    const animate = () => {
      frame++;
      // More dramatic pan/zoom
      setImageZoom({
        x: Math.sin(frame / 40) * 5,
        y: Math.cos(frame / 50) * 4,
        scale: 1.1 + Math.sin(frame / 60) * 0.08,
      });
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();
  }, []);

  const stopImageAnimation = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Show next article with dramatic animation sequence
  const showNextArticle = useCallback(() => {
    setCurrentIndex(prev => {
      const nextIndex = prev + 1;
      if (nextIndex >= news.length) return prev;

      // Phase 1: Move current to aside
      setPhase('moving');
      setDisplayedArticles(current => {
        const updated = current.map((a, i) => {
          if (a.state === 'focused') {
            const asideCount = current.filter(x => x.state === 'aside').length;
            return {
              ...a,
              state: 'aside' as const,
              style: getAsideStyle(asideCount, current.length),
            };
          }
          return a;
        });

        // Add new article off-screen
        const newArticle: ArticleDisplay = {
          article: news[nextIndex],
          index: nextIndex,
          state: 'entering',
          style: getEnteringStyle(),
        };
        
        return [...updated, newArticle];
      });

      // Phase 2: After brief delay, slide new article to center
      setTimeout(() => {
        setPhase('entering');
        setDisplayedArticles(current => 
          current.map(a => {
            if (a.index === nextIndex) {
              return { ...a, state: 'focused', style: getFocusedStyle() };
            }
            return a;
          })
        );
      }, 200);

      // Phase 3: Start analyzing
      setTimeout(() => {
        setPhase('analyzing');
      }, 1000);

      return nextIndex;
    });
  }, [news, getAsideStyle, getEnteringStyle, getFocusedStyle]);

  // Start sequence when visible
  useEffect(() => {
    if (!isVisible || news.length === 0) return;

    // Reset
    setDisplayedArticles([]);
    setCurrentIndex(-1);
    setPhase('idle');

    // Start image animation
    animateImage();

    // Begin sequence after short delay
    const startTimeout = setTimeout(() => {
      showNextArticle();
    }, 800);

    // Continue showing articles on timer (~4.5s per headline)
    sequenceRef.current = setInterval(() => {
      showNextArticle();
    }, 4500);

    return () => {
      clearTimeout(startTimeout);
      if (sequenceRef.current) clearInterval(sequenceRef.current);
      stopImageAnimation();
    };
  }, [isVisible, news, animateImage, stopImageAnimation, showNextArticle]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (sequenceRef.current) clearInterval(sequenceRef.current);
      stopImageAnimation();
    };
  }, [stopImageAnimation]);

  if (!isVisible) return null;

  const focusedArticle = displayedArticles.find(a => a.state === 'focused');

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-black/95">
      {/* Ambient glow effect */}
      <div className="absolute inset-0 bg-gradient-radial from-cyan-900/20 via-transparent to-transparent" />
      
      {/* Top HUD */}
      <div className="absolute top-0 left-0 right-0 p-4 z-50 flex justify-between items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse shadow-lg shadow-cyan-400/50" />
            <span className="text-cyan-400 font-mono text-sm tracking-[0.4em] uppercase">
              News Analysis
            </span>
          </div>
          <div className="text-cyan-600/60 text-[10px] font-mono ml-6">
            &gt;&gt; SCANNING GLOBAL FEEDS...
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          {isSpeaking && (
            <div className="flex items-center gap-2 bg-cyan-500/20 px-3 py-1 border border-cyan-500/50">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-green-400 text-xs font-mono">LIVE BRIEFING</span>
            </div>
          )}
          <div className="text-cyan-500 text-sm font-mono">
            {currentIndex + 1} / {news.length}
          </div>
          <button 
            onClick={onClose} 
            className="text-cyan-600 hover:text-cyan-400 text-3xl leading-none hover:scale-110 transition-transform"
          >
            ×
          </button>
        </div>
      </div>

      {/* Article Display Area */}
      <div className="absolute inset-0">
        {displayedArticles.map((item) => (
          <div
            key={item.index}
            className="absolute"
            style={{
              ...item.style,
              width: '600px',
              height: '450px',
            }}
          >
            {/* Article Frame */}
            <div className={`
              w-full h-full relative overflow-hidden
              ${item.state === 'focused' 
                ? 'bg-slate-800 border-2 border-cyan-500 shadow-2xl shadow-cyan-500/30' 
                : 'bg-slate-900 border border-cyan-800/50'}
            `}>
              {/* HUD Corners - more prominent for focused */}
              <div className={`absolute top-0 left-0 border-t-2 border-l-2 border-cyan-400 z-20
                ${item.state === 'focused' ? 'w-12 h-12' : 'w-6 h-6 opacity-50'}`} />
              <div className={`absolute top-0 right-0 border-t-2 border-r-2 border-cyan-400 z-20
                ${item.state === 'focused' ? 'w-12 h-12' : 'w-6 h-6 opacity-50'}`} />
              <div className={`absolute bottom-0 left-0 border-b-2 border-l-2 border-cyan-400 z-20
                ${item.state === 'focused' ? 'w-12 h-12' : 'w-6 h-6 opacity-50'}`} />
              <div className={`absolute bottom-0 right-0 border-b-2 border-r-2 border-cyan-400 z-20
                ${item.state === 'focused' ? 'w-12 h-12' : 'w-6 h-6 opacity-50'}`} />

              {/* Image Section - 65% height */}
              <div className="h-[65%] overflow-hidden bg-black relative">
                {item.article.imageUrl ? (
                  <>
                    <img
                      src={item.article.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      style={item.state === 'focused' ? {
                        transform: `translate(${imageZoom.x}%, ${imageZoom.y}%) scale(${imageZoom.scale})`,
                        transition: 'transform 0.1s linear',
                      } : {}}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    
                    {/* Scan effect for focused */}
                    {item.state === 'focused' && (
                      <>
                        <div className="absolute inset-0 pointer-events-none">
                          <div 
                            className="absolute w-full h-1 bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent"
                            style={{ animation: 'scanDown 2.5s linear infinite' }}
                          />
                        </div>
                        
                        {/* Analysis grid */}
                        <svg className="absolute inset-0 w-full h-full pointer-events-none">
                          <defs>
                            <pattern id={`grid-${item.index}`} width="40" height="40" patternUnits="userSpaceOnUse">
                              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,255,255,0.15)" strokeWidth="0.5"/>
                            </pattern>
                          </defs>
                          <rect width="100%" height="100%" fill={`url(#grid-${item.index})`} />
                        </svg>

                        {/* Center target reticle */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-20 h-20 border border-cyan-400/30 rounded-full" />
                          <div className="absolute w-32 h-32 border border-cyan-400/20 rounded-full" />
                          <div className="absolute w-1 h-8 bg-cyan-400/30" />
                          <div className="absolute w-8 h-1 bg-cyan-400/30" />
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-900">
                    <span className="text-cyan-700 font-mono text-sm">[NO IMAGE DATA]</span>
                  </div>
                )}

                {/* Source watermark */}
                <div className="absolute bottom-3 left-3 bg-black/90 px-3 py-1.5 border-l-2 border-cyan-400">
                  <span className="text-cyan-400 text-xs font-mono font-bold uppercase tracking-wider">
                    {item.article.source}
                  </span>
                </div>
              </div>

              {/* Text Section */}
              <div className="h-[35%] p-4 flex flex-col justify-between bg-gradient-to-b from-slate-800 to-slate-900">
                <div>
                  <h3 className={`font-semibold leading-tight mb-2 line-clamp-2
                    ${item.state === 'focused' ? 'text-white text-base' : 'text-white/80 text-sm'}`}>
                    {item.article.title}
                  </h3>
                  {item.state === 'focused' && item.article.description && (
                    <p className="text-cyan-300/50 text-xs leading-relaxed line-clamp-2">
                      {item.article.description.replace(/<[^>]*>/g, '').substring(0, 150)}...
                    </p>
                  )}
                </div>
                
                <div className="flex justify-between items-center text-[10px] font-mono">
                  <span className="text-cyan-600">
                    {item.article.pubDate ? new Date(item.article.pubDate).toLocaleDateString() : ''}
                  </span>
                  {item.state === 'focused' && item.article.link && (
                    <a 
                      href={item.article.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 hover:underline"
                    >
                      VIEW SOURCE →
                    </a>
                  )}
                </div>
              </div>

              {/* READING badge */}
              {item.state === 'focused' && isSpeaking && (
                <div className="absolute top-4 right-4 bg-cyan-400 text-black text-[10px] font-bold px-2 py-1 animate-pulse z-30">
                  ANALYZING
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom status */}
      <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-between items-center text-[10px] font-mono text-cyan-700 z-50 border-t border-cyan-900/50">
        <div className="flex items-center gap-4">
          <span>J.A.R.V.I.S. NEWS MODULE</span>
          <span className="text-cyan-900">|</span>
          <span>STARK INDUSTRIES</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-cyan-600">{displayedArticles.length} ARTICLES LOADED</span>
          <span>{new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <style>{`
        @keyframes scanDown {
          0% { top: -5%; }
          100% { top: 105%; }
        }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .bg-gradient-radial {
          background: radial-gradient(ellipse at center, var(--tw-gradient-from), var(--tw-gradient-via), var(--tw-gradient-to));
        }
      `}</style>
    </div>
  );
};

export default NewsDossier;
