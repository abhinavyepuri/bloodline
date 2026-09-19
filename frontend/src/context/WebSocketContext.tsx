import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WebSocketEvent } from '../types';
import { WS_URL } from '../config';
import { useAuth } from './AuthContext';

interface WebSocketContextType {
  isConnected: boolean;
  events: WebSocketEvent[];
  lastEvent: WebSocketEvent | null;
  toastMessage: { title: string; text: string; type: 'info' | 'urgent' | 'success' } | null;
  dismissToast: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

/** Close code the server sends when the token is missing, invalid or expired. */
const WS_POLICY_VIOLATION = 1008;
const RECONNECT_DELAY_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 25000;

/** Event types that should surface as a toast, and how they should look. */
function toastFor(event: WebSocketEvent): WebSocketContextType['toastMessage'] {
  switch (event.type) {
    case 'RE_PLANNING_TRIGGERED':
      return {
        title: '⚠️ REPLACEMENT NEEDED',
        text:
          event.message ||
          'A blood unit became unavailable. The system is searching for a replacement.',
        type: 'urgent',
      };
    case 'EMERGENCY_DISPATCH_ALERT':
      return {
        title: '🩸 EMERGENCY: DONORS NEEDED',
        text: event.message || 'A nearby hospital urgently needs blood.',
        type: 'urgent',
      };
    case 'INVENTORY_LOCKED':
    case 'DONOR_CLAIM_SUCCESS':
      return {
        title: '✅ BLOOD RESERVED & EN ROUTE',
        text: event.message || 'Blood unit secured and on the way to the hospital.',
        type: 'success',
      };
    case 'BLOOD_BANK_DISPATCHED':
      return {
        title: '🚑 BLOOD DISPATCHED',
        text: event.message || 'Blood bank packed and dispatched blood units to the ambulance!',
        type: 'success',
      };
    case 'BLOOD_BANK_ACCEPTED':
      return {
        title: '📦 ORDER ACCEPTED',
        text: event.message || 'Blood bank accepted the order and reserved units from storage.',
        type: 'success',
      };
    case 'AUTH_ERROR':
      return { title: '🔒 SESSION REJECTED', text: event.message || 'Please sign in again.', type: 'info' };
    default:
      return null;
  }
}

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [events, setEvents] = useState<WebSocketEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const [toastMessage, setToastMessage] = useState<WebSocketContextType['toastMessage']>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Guards the reconnect loop. Without it, unmounting called close(), which fired
   * onclose, which scheduled another connect() — so the socket reconnected forever
   * and React 19's StrictMode double-mount doubled the loop.
   */
  const shouldReconnectRef = useRef<boolean>(false);

  const dismissToast = useCallback(() => setToastMessage(null), []);

  useEffect(() => {
    if (!token) {
      // Signed out: nothing to connect with.
      setIsConnected(false);
      return;
    }

    shouldReconnectRef.current = true;
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (!shouldReconnectRef.current) return;

      let socket: WebSocket;
      try {
        socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      } catch (err) {
        console.error('Failed to open SmartBlood WebSocket:', err);
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }

      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
      };

      socket.onmessage = (messageEvent) => {
        let data: WebSocketEvent;
        try {
          data = JSON.parse(messageEvent.data) as WebSocketEvent;
        } catch {
          return; // Ignore anything that is not JSON (e.g. a bare pong).
        }

        if (data.type === 'pong' || data.type === 'AUTH_ERROR') {
          if (data.type === 'AUTH_ERROR') {
            console.warn('SmartBlood WebSocket rejected the session:', data.message);
            setToastMessage(toastFor(data));
          }
          return;
        }

        setLastEvent(data);
        setEvents((prev) => [data, ...prev.slice(0, 49)]);

        const toast = toastFor(data);
        if (toast) setToastMessage(toast);
      };

      socket.onclose = (closeEvent) => {
        setIsConnected(false);
        socketRef.current = null;

        if (closeEvent.code === WS_POLICY_VIOLATION) {
          // The server refused our token. Reconnecting would loop against a decision
          // that will not change until the user signs in again.
          shouldReconnectRef.current = false;
          setToastMessage({
            title: '🔒 SESSION REJECTED',
            text: 'Your session is no longer valid. Please sign in again.',
            type: 'info',
          });
          return;
        }

        if (shouldReconnectRef.current) {
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      socket.onerror = () => {
        // onclose always follows; let it own the reconnect decision.
        socket.close();
      };
    };

    connect();

    pingInterval = setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send('ping');
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      // Stop the loop before closing, so this close does not schedule a reconnect.
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingInterval) clearInterval(pingInterval);

      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      }
      setIsConnected(false);
    };
  }, [token]);

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
