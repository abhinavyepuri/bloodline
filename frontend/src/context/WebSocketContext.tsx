import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { WebSocketEvent } from '../types';

interface WebSocketContextType {
  isConnected: boolean;
  events: WebSocketEvent[];
  lastEvent: WebSocketEvent | null;
  toastMessage: { title: string; text: string; type: 'info' | 'urgent' | 'success' } | null;
  dismissToast: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [events, setEvents] = useState<WebSocketEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    text: string;
    type: 'info' | 'urgent' | 'success';
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  const dismissToast = () => setToastMessage(null);

  const connect = () => {
    try {
      const socket = new WebSocket('ws://localhost:8000/api/v1/realtime/ws');
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        console.log('⚡ Connected to SmartBlood real-time WebSocket');
      };

      socket.onmessage = (messageEvent) => {
        try {
          const data = JSON.parse(messageEvent.data);
          if (data.type === 'pong') return;

          setLastEvent(data);
          setEvents((prev) => [data, ...prev.slice(0, 49)]);

          // Trigger toast for high-priority events
          if (data.type === 'EMERGENCY_DISPATCH_ALERT') {
            setToastMessage({
              title: '🚨 EMERGENCY ALERT',
              text: data.message || `Hospital urgently needs ${data.required_blood_group} blood!`,
              type: 'urgent',
            });
          } else if (data.type === 'RE_PLANNING_TRIGGERED') {
            setToastMessage({
              title: '⚠️ REPLACEMENT NEEDED',
              text: data.message || 'A blood unit was spoiled. System is searching for an immediate replacement.',
              type: 'urgent',
            });
          } else if (data.type === 'INVENTORY_LOCKED' || data.type === 'DONOR_CLAIM_SUCCESS') {
            setToastMessage({
              title: '✅ BLOOD RESERVED & EN ROUTE',
              text: data.message || 'Blood unit secured and on the way to the hospital.',
              type: 'success',
            });
          }
        } catch (err) {
          console.warn('Non-JSON WebSocket message received:', messageEvent.data);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        console.warn('SmartBlood WebSocket closed. Reconnecting in 3s...');
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      socket.onerror = (err) => {
        console.error('WebSocket error:', err);
        socket.close();
      };
    } catch (err) {
      console.error('Failed to instantiate WebSocket:', err);
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    }
  };

  useEffect(() => {
    connect();

    // Heartbeat ping interval
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, 25000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return (
    <WebSocketContext.Provider
      value={{ isConnected, events, lastEvent, toastMessage, dismissToast }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) throw new Error('useWebSocket must be used within a WebSocketProvider');
  return context;
};
