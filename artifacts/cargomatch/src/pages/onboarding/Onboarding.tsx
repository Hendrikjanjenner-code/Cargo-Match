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
  name: z.string().min(2, t("onboarding.error_name")),
  country: z.string().length(2, t("onboarding.error_country")),
  activities: z.array(z.nativeEnum(CompanyActivity)).min(1, t("onboarding.error_activity")),
  primaryContactName: z.string().min(2, t("onboarding.error_contact")),
  email: z.string().email(t("onboarding.error_email")),
  phone: z.string().min(5, t("onboarding.error_phone")),
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
           <CardTitle className="text-2xl">{t("onboarding.title")}</CardTitle>
           <p className="text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
               <Label>{t("onboarding.company_name")}</Label>
               <Input {...register("name")} placeholder={t("onboarding.company_name_placeholder")} />
              {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                 <Label>{t("onboarding.country_code")}</Label>
                 <Input {...register("country")} placeholder={t("onboarding.country_placeholder")} maxLength={2} />
                {errors.country && <span className="text-xs text-destructive">{errors.country.message}</span>}
              </div>
              <div className="space-y-2">
                 <Label>{t("onboarding.vat_optional")}</Label>
                 <Input {...register("vatRegistrationNumber")} placeholder={t("onboarding.vat_placeholder")} />
              </div>
            </div>

            <div className="space-y-2">
               <Label>{t("onboarding.business_activities")}</Label>
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
                 <Label>{t("onboarding.primary_contact")}</Label>
                 <Input {...register("primaryContactName")} placeholder={t("onboarding.primary_contact_placeholder")} />
                {errors.primaryContactName && <span className="text-xs text-destructive">{errors.primaryContactName.message}</span>}
              </div>
              <div className="space-y-2">
                 <Label>{t("company.email")}</Label>
                 <Input type="email" {...register("email")} placeholder={t("onboarding.email_placeholder")} />
                {errors.email && <span className="text-xs text-destructive">{errors.email.message}</span>}
              </div>
            </div>

            <div className="space-y-2">
               <Label>{t("onboarding.phone")}</Label>
               <Input {...register("phone")} placeholder={t("onboarding.phone_placeholder")} />
              {errors.phone && <span className="text-xs text-destructive">{errors.phone.message}</span>}
            </div>

            <Button type="submit" className="w-full mt-6" disabled={createCompany.isPending}>
               {createCompany.isPending ? t("onboarding.creating") : t("onboarding.complete_setup")}
            </Button>
            {createCompany.isError && (
               <div className="p-3 mt-4 bg-destructive/10 text-destructive text-sm rounded-md">
                 {t("error.create_company")}
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
