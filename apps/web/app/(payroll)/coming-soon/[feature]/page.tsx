import { DollarSign, FileText, HeartHandshake, BarChart3 } from 'lucide-react';
import { ComingSoon } from '@/components/ui/ComingSoon';

const FEATURE_MAP: Record<string, {
  label: string;
  description: string;
  Icon: React.ElementType;
}> = {
  runs: {
    label: 'Pay Runs',
    description: 'Process payroll for all your staff — compute net pay, deductions, and taxes automatically.',
    Icon: DollarSign,
  },
  payslips: {
    label: 'Payslips',
    description: 'Generate and distribute digital payslips to every employee with a single click.',
    Icon: FileText,
  },
  contributions: {
    label: 'SSS / PhilHealth / Pag-IBIG',
    description: 'Auto-compute government contributions and generate filing-ready reports.',
    Icon: HeartHandshake,
  },
  reports: {
    label: 'Compliance Reports',
    description: 'BIR, SSS, PhilHealth, and Pag-IBIG compliance reports — ready to file.',
    Icon: BarChart3,
  },
};

export default function ComingSoonPage({ params }: { params: { feature: string } }) {
  const config = FEATURE_MAP[params.feature] ?? {
    label: 'This Feature',
    description: "We're building this.",
    Icon: BarChart3,
  };

  return (
    <div className="overflow-y-auto h-full p-6">
      <ComingSoon
        icon={config.Icon as any}
        feature={config.label}
        description={config.description}
      />
    </div>
  );
}
