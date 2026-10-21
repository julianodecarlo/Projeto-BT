import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Sem credenciais válidas, cria um cliente "dummy" (URL de placeholder) para
// não quebrar a inicialização do app; todas as chamadas falharão, mas a
// interface continua carregando e exibindo os estados de erro normalmente.
const hasValidCreds = supabaseUrl.startsWith('http') && supabaseAnonKey.length > 0;

export const supabase = createClient(
  hasValidCreds ? supabaseUrl : 'https://placeholder.supabase.co',
  hasValidCreds ? supabaseAnonKey : 'public-anon-key'
);
