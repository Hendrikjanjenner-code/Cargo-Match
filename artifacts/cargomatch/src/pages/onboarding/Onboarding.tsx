import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useCreateMyCompany, getGetMyCompanyQueryKey, CompanyActivity } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label } from "@/components/ui/primitives";
import { Ship } from "lucide-react";
import { t } from "@/lib/i18n";

const schema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters"),
  country: z.string().length(2, "Use 2-letter ISO country code (e.g., NL, DE, BE)"),
  activities: z.array(z.nativeEnum(CompanyActivity)).min(1, "Select at least one activity"),
  primaryContactName: z.string().min(2, "Contact name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(5, "Phone number is required"),
  vatRegistrationNumber: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createCompany = useCreateMyCompany();

  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { activities: [] }
  });

  const selectedActivities = watch("activities");

  const onSubmit = (data: FormValues) => {
    createCompany.mutate(
      { data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMyCompanyQueryKey() });
          setLocation("/");
        }
      }
    );
  };

  const toggleActivity = (activity: CompanyActivity) => {
    if (selectedActivities.includes(activity)) {
      setValue("activities", selectedActivities.filter(a => a !== activity), { shouldValidate: true });
    } else {
      setValue("activities", [...selectedActivities, activity], { shouldValidate: true });
    }
  };

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto bg-primary text-primary-foreground w-12 h-12 flex items-center justify-center rounded-full mb-2">
            <Ship className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Create your company profile</CardTitle>
          <p className="text-sm text-muted-foreground">You need an active company profile to access the network.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input {...register("name")} placeholder="Acme Logistics B.V." />
              {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Country (2-letter code)</Label>
                <Input {...register("country")} placeholder="NL" maxLength={2} />
                {errors.country && <span className="text-xs text-destructive">{errors.country.message}</span>}
              </div>
              <div className="space-y-2">
                <Label>VAT Number (Optional)</Label>
                <Input {...register("vatRegistrationNumber")} placeholder="NL123456789B01" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Business Activities</Label>
              <div className="flex gap-2 flex-wrap">
                {Object.values(CompanyActivity).map(act => (
                  <button
                    key={act}
                    type="button"
                    onClick={() => toggleActivity(act)}
                    className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                      selectedActivities.includes(act) 
                        ? "bg-primary text-primary-foreground border-primary" 
                        : "bg-background text-foreground hover:bg-muted"
                    }`}
                  >
                    {act}
                  </button>
                ))}
              </div>
              {errors.activities && <span className="text-xs text-destructive">{errors.activities.message}</span>}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div className="space-y-2">
                <Label>Primary Contact</Label>
                <Input {...register("primaryContactName")} placeholder="Jane Doe" />
                {errors.primaryContactName && <span className="text-xs text-destructive">{errors.primaryContactName.message}</span>}
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" {...register("email")} placeholder="jane@example.com" />
                {errors.email && <span className="text-xs text-destructive">{errors.email.message}</span>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input {...register("phone")} placeholder="+31 6 12345678" />
              {errors.phone && <span className="text-xs text-destructive">{errors.phone.message}</span>}
            </div>

            <Button type="submit" className="w-full mt-6" disabled={createCompany.isPending}>
              {createCompany.isPending ? "Creating..." : "Complete Setup"}
            </Button>
            {createCompany.isError && (
              <div className="p-3 mt-4 bg-destructive/10 text-destructive text-sm rounded-md">
                Failed to create company. Please check the fields and try again.
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
