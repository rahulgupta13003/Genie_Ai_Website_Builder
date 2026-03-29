import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ProjectPreview from "../components/ProjectPreview";
import type { Project } from "../types";
import api from "@/configs/axios";
import { toast } from "sonner";



const Preview = () => {

  const {projectId , versionId} = useParams();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchCode = async () => {
    try {
      const {data} = await api.get(`/api/user/project/${projectId}`)
      const project = data.project as Project
      if(versionId) {
        const selectedVersion = project.versions?.find((version) => version.id === versionId)
        setCode(selectedVersion?.code || project.current_code || '')
      } else {
        setCode(project.current_code || '')
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to load preview')
    } finally {
      setLoading(false)
    }
  }    
  
  useEffect(() => {
    fetchCode()
  }, [])

  if (loading) {
    return (
      <div className='flex items-center justify-center h-screen'>
        <Loader2Icon className='size-7 animate-spin text-indigo-200'/>
      </div>
    )
  }

  return (
    <div className="h-screen">
      {code && <ProjectPreview project={{current_code: code} as Project}
      isGenerating= {false} showEditorPanel={false}/>}
    </div>
  )
}

export default Preview
