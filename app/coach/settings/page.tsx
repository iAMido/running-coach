'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { User, Heart, Save, CheckCircle } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);

  // Profile state
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [restingHr, setRestingHr] = useState('');
  const [maxHr, setMaxHr] = useState('');
  const [ltHr, setLtHr] = useState('');
  const [goal, setGoal] = useState('');
  const [trainingDays, setTrainingDays] = useState('');

  // HR Zones state
  const [zone1, setZone1] = useState('');
  const [zone2, setZone2] = useState('');
  const [zone3, setZone3] = useState('');
  const [zone4, setZone4] = useState('');
  const [zone5, setZone5] = useState('');
  const [zone6, setZone6] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await fetch('/api/coach/profile');
      const data = await response.json();

      if (data.profile) {
        const p = data.profile;
        setName(p.name || '');
        setAge(p.age?.toString() || '');
        setWeight(p.weight_kg?.toString() || '');
        setRestingHr(p.resting_hr?.toString() || '');
        setMaxHr(p.max_hr?.toString() || '');
        setLtHr(p.lactate_threshold_hr?.toString() || '');
        setGoal(p.current_goal || '');
        setTrainingDays(p.training_days || '');
        setZone1(p.hr_zone_z1 || '');
        setZone2(p.hr_zone_z2 || '');
        setZone3(p.hr_zone_z3 || '');
        setZone4(p.hr_zone_z4 || '');
        setZone5(p.hr_zone_z5 || '');
        setZone6(p.hr_zone_z6 || '');
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch('/api/coach/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          age: age ? parseInt(age) : null,
          weight_kg: weight ? parseFloat(weight) : null,
          resting_hr: restingHr ? parseInt(restingHr) : null,
          max_hr: maxHr ? parseInt(maxHr) : null,
          lactate_threshold_hr: ltHr ? parseInt(ltHr) : null,
          current_goal: goal,
          training_days: trainingDays,
          hr_zone_z1: zone1,
          hr_zone_z2: zone2,
          hr_zone_z3: zone3,
          hr_zone_z4: zone4,
          hr_zone_z5: zone5,
          hr_zone_z6: zone6,
        }),
      });

      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (error) {
      console.error('Failed to save profile:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveZones = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch('/api/coach/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          age: age ? parseInt(age) : null,
          weight_kg: weight ? parseFloat(weight) : null,
          resting_hr: restingHr ? parseInt(restingHr) : null,
          max_hr: maxHr ? parseInt(maxHr) : null,
          lactate_threshold_hr: ltHr ? parseInt(ltHr) : null,
          current_goal: goal,
          training_days: trainingDays,
          hr_zone_z1: zone1,
          hr_zone_z2: zone2,
          hr_zone_z3: zone3,
          hr_zone_z4: zone4,
          hr_zone_z5: zone5,
          hr_zone_z6: zone6,
        }),
      });

      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (error) {
      console.error('Failed to save zones:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Manage your athlete profile and preferences.
          </p>
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your athlete profile and preferences.
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">
            <User className="w-4 h-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="zones">
            <Heart className="w-4 h-4 mr-2" />
            HR Zones
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Athlete Profile
              </CardTitle>
              <CardDescription>
                Your personal information used for training calculations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Age</label>
                  <Input type="number" value={age} onChange={(e) => setAge(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Weight (kg)</label>
                  <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Resting HR (bpm)</label>
                  <Input type="number" value={restingHr} onChange={(e) => setRestingHr(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max HR (bpm)</label>
                  <Input type="number" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Lactate Threshold HR (bpm)</label>
                  <Input type="number" value={ltHr} onChange={(e) => setLtHr(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Current Goal</label>
                <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Training Days</label>
                <Input
                  value={trainingDays}
                  onChange={(e) => setTrainingDays(e.target.value)}
                  placeholder="e.g., Mon, Wed, Fri, Sun"
                />
              </div>

              <Button
                onClick={handleSaveProfile}
                disabled={saving}
                className="bg-gradient-to-r from-blue-500 to-green-500 text-white"
              >
                {saved ? (
                  <CheckCircle className="w-4 h-4 mr-2" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* HR Zones Tab */}
        <TabsContent value="zones">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Heart className="w-5 h-5" />
                Heart Rate Zones
              </CardTitle>
              <CardDescription>
                Configure your personal HR zones for training intensity tracking.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-gray-400" />
                    Zone 1 (Recovery)
                  </label>
                  <Input value={zone1} onChange={(e) => setZone1(e.target.value)} placeholder="0-120" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-400" />
                    Zone 2 (Easy)
                  </label>
                  <Input value={zone2} onChange={(e) => setZone2(e.target.value)} placeholder="120-135" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-green-400" />
                    Zone 3 (Moderate)
                  </label>
                  <Input value={zone3} onChange={(e) => setZone3(e.target.value)} placeholder="135-150" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-yellow-400" />
                    Zone 4 (Threshold)
                  </label>
                  <Input value={zone4} onChange={(e) => setZone4(e.target.value)} placeholder="150-165" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-orange-400" />
                    Zone 5 (VO2max)
                  </label>
                  <Input value={zone5} onChange={(e) => setZone5(e.target.value)} placeholder="165-175" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-500" />
                    Zone 6 (Anaerobic)
                  </label>
                  <Input value={zone6} onChange={(e) => setZone6(e.target.value)} placeholder="175+" />
                </div>
              </div>

              <Button
                onClick={handleSaveZones}
                disabled={saving}
                className="bg-gradient-to-r from-blue-500 to-green-500 text-white"
              >
                {saved ? (
                  <CheckCircle className="w-4 h-4 mr-2" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Zones'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
