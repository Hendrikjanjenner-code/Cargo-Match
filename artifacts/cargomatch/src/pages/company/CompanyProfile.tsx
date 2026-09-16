import { useGetMyCompany, useUpdateMyCompany, getGetMyCompanyQueryKey, CompanyActivity } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Label, Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/primitives";
import { useState, useEffect } from "react";
import { Building2 } from "lucide-react";
import { t } from "@/lib/i18n";

const schema = z.object({
  name: z.string().min(2),
  country: z.string().length(2),
  activities: z.array(z.nativeEnum(CompanyActivity)).min(1),
  primaryContactName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(5),
  vatRegistrationNumber: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

export default function CompanyProfile() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  
  const { data: company, isLoading } = useGetMyCompany({
    query: { queryKey: getGetMyCompanyQueryKey() }
  });
  const updateCompany = useUpdateMyCompany();

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const selectedActivities = watch("activities") || [];

  useEffect(() => {
    if (company && !isEditing) {
      reset({
        name: company.name,
        country: company.country,
        activities: company.activities,
        primaryContactName: company.primaryContactName,
        email: company.email,
        phone: company.phone,
        vatRegistrationNumber: company.vatRegistrationNumber || ""
      });
    }
  }, [company, isEditing, reset]);

  if (isLoading) return <div className="p-8 text-center">{t("company.loading")}</div>;
  if (!company) return null;

  const onSubmit = (data: FormValues) => {
    updateCompany.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMyCompanyQueryKey() });
        setIsEditing(false);
      }
    });
  };

  const toggleActivity = (activity: CompanyActivity) => {
    if (selectedActivities.includes(activity)) {
      setValue("activities", selectedActivities.filter(a => a !== activity), { shouldValidate: true });
    } else {
      setValue("activities", [...selectedActivities, activity], { shouldValidate: true });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("company.title")}</h1>
          <p className="text-muted-foreground">{t("company.subtitle")}</p>
        </div>
        {!isEditing && (
          <Button onClick={() => setIsEditing(true)}>{t("company.edit_profile")}</Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <div className="h-16 w-16 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
            <Building2 className="h-8 w-8" />
          </div>
          <div>
            <CardTitle className="text-xl">{company.name}</CardTitle>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={company.status === 'ACTIVE' ? 'default' : 'destructive'} className={company.status === 'ACTIVE' ? "bg-emerald-600" : ""}>
                {t(`status.${company.status.toLowerCase()}`)}
              </Badge>
              {company.verified && <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">{t("company.verified")}</Badge>}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("company.name")}</Label>
                  <Input {...register("name")} />
                  {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>{t("company.country_code")}</Label>
                  <Input {...register("country")} maxLength={2} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{t("company.activities")}</Label>
                  <div className="flex gap-2">
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
                <div className="space-y-2">
                  <Label>{t("company.primary_contact")}</Label>
                  <Input {...register("primaryContactName")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("company.email")}</Label>
                  <Input type="email" {...register("email")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("company.phone")}</Label>
                  <Input {...register("phone")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("company.vat_number")}</Label>
                  <Input {...register("vatRegistrationNumber")} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>{t("action.cancel")}</Button>
                <Button type="submit" disabled={updateCompany.isPending}>{t("action.save_changes")}</Button>
              </div>
            </form>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-4 text-sm">
              <div>
                <div className="font-semibold text-muted-foreground mb-1">{t("company.country_code")}</div>
                <div>{company.country}</div>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground mb-1">{t("company.vat_number")}</div>
                <div>{company.vatRegistrationNumber || "-"}</div>
              </div>
              <div className="md:col-span-2">
                <div className="font-semibold text-muted-foreground mb-1">{t("company.activities")}</div>
                <div className="flex gap-2">
                  {company.activities.map(a => <Badge key={a} variant="outline">{a}</Badge>)}
                </div>
              </div>
              <div className="pt-4 border-t md:col-span-2">
                <h3 className="font-semibold text-base mb-4">{t("company.contact_information")}</h3>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground mb-1">{t("company.primary_contact")}</div>
                <div>{company.primaryContactName}</div>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground mb-1">{t("company.email")}</div>
                <div>{company.email}</div>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground mb-1">{t("company.phone")}</div>
                <div>{company.phone}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
