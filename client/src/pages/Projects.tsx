import { useEffect, useRef, useState} from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Project } from '../types';
import { ArrowBigDownDashIcon, EyeIcon, EyeOffIcon, FullscreenIcon, LaptopIcon, Loader2Icon, MessageSquareIcon, SaveIcon, SmartphoneIcon, TabletIcon, XIcon } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import ProjectPreview, { type ProjectPreviewRef } from '../components/ProjectPreview';
import api from '@/configs/axios';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';

const Projects = () => {
  const{projectId} = useParams()
  const navigate = useNavigate()
  const {data: session, isPending} = authClient.useSession()

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  const [isGenerating, setIsGenerating] = useState(true)
  const [device, setDevice] = useState<'mobile' | 'desktop' | 'tablet'>('desktop')

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const previewRef = useRef<ProjectPreviewRef>(null);
  const fetchProject = async () => {
    try {
      const {data} = await api.get(`/api/user/project/${projectId}`)
      setProject(data.project)
      setIsGenerating(data.project.current_code ? false : true)
      setLoading(false)

    } catch(error:any) {
      toast.error(error?.response?.data?.message || 'Failed to fetch project')
      console.error('Error fetching project:', error);
      navigate('/projects')
    }
  }

  const downloadCode =()=> {
    const code = previewRef.current?.getcode() || project?.current_code;
    if(!code){
      if(isGenerating){
        return
      }
      return
    }
    const element = document.createElement("a");
    const file = new Blob([code], {type: 'text/html'});
    element.href = URL.createObjectURL(file);
    element.download = `${project?.name || 'project'}.html`;
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();


  };

  const togglePublish =  () => {
    if(!project) return;
    api.get(`/api/user/publish-toggle/${project.id}`)
      .then((response) => {
        toast.success(response?.data?.message || 'Publish status updated')
        fetchProject()
      })
      .catch((error: any) => {
        toast.error(error?.response?.data?.message || 'Failed to update publish status')
      })
  };

  const saveProject = async () => {
    if(!project) return;
    const code = previewRef.current?.getcode() || project.current_code;
    if(!code) {
      toast.error('No code found to save')
      return;
    }

    try {
      setIsSaving(true)
      await api.post(`/api/project/save/${project.id}`, {code})
      toast.success('Project saved successfully')
      await fetchProject()
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to save project')
    } finally {
      setIsSaving(false)
    }

  }

  useEffect(() => {
    if(session?.user) {
      fetchProject();
    }else if(!isPending && !session?.user) {
      navigate('/auth/signin')
      toast("Please login to view your projects")
    }
  }, [session?.user, isPending])

  useEffect(() => {
    if(project && !project.current_code) {
      const intervalId = setInterval(fetchProject, 3000);
      return () => clearInterval(intervalId);
    }
    
  },[project])

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center h-screen">
          <Loader2Icon className="size-7 animate-spin text-indigo-200" />
        </div>
      </>
    )
  }
  return project ? (
    <div className='flex flex-col h-screen w-full bg-gray-900 text-white'>
      {/* Your project page content goes here */}
      <div className='flex max-sm:flex-col sm:items-center gap-4 px-4 py-2 no-scrollbar'>
        {/* left */}
        <div className='flex items-center gap-2 sm:min-w-90 text-nowrap'>
          <img src="/fevicon.svg" alt="logo" className="h-6 cursor-pointer" onClick={()=> navigate('/')} />
          <div className='max-w-64 sm:max-w-xs'>
            <p className='text-sm font-medium capitalize truncate'>{project.name}</p>
            <p className='text-xs text-gray-400 -mt-0.5'>Previewing Last Saved Version</p>
          </div>
          <div className='sm:hidden flex-1 flex justify-end'>
            {isMenuOpen ? <MessageSquareIcon onClick={() => setIsMenuOpen(false)} className="size-6 cursor-pointer"/> : <XIcon onClick={() => setIsMenuOpen(true)} className="size-6 cursor-pointer" />}
          </div>
        </div>
        {/* center */}
        <div className='hidden sm:flex gap-2 bg-gray-950 p-1.5 rounded-md'>
          <SmartphoneIcon  onClick={()=> setDevice('mobile')} className={`size-6 p-1 rounded cursor-pointer ${device === 'mobile' ? 'text-indigo-400' : "" }`}/>
          <TabletIcon onClick={()=> setDevice('tablet')} className={`size-6 p-1 rounded cursor-pointer ${device === 'tablet' ? 'text-indigo-400' : "" }`}/>
          <LaptopIcon  onClick={()=> setDevice('desktop')} className={`size-6 p-1 rounded  cursor-pointer ${device === 'desktop' ? 'text-indigo-400' : ""}`}/>
        </div>
        {/* right */}
        <div className='flex items-center justify-end gap-3 flex-1 text-xs sm:text-sm'>
          <button onClick={saveProject} disabled = {isSaving} className='max-sm:hidden bg-gray-800 hover:bg-gray-700 text-white px-3.5 py-1 flex items-center gap-2 rounded sm:rounded-sm transition-colors border border-gray-700'>
            {isSaving ? <Loader2Icon className=" animate-spin" size={16}/> :
            < SaveIcon size={16}/>} Save
          </button>
          <Link target='_blank' to={`/preview/${project.id}`} className='flex items-center gap-2 px-4 py-1 rounded sm:rounded-sm border border-gray-700 hover:border-gray-500 transition-colors' >
          <FullscreenIcon size={16}/> Preview
          </Link>
          <button onClick={downloadCode} className='bg-linear-to-br from-blue-700 to-blue-600 hover:from-blue-600 hover:to-blue-500 text-white px-3.5 py-1 flex items-center gap-2 rounded sm:rounded-sm transition-colors'>
            <ArrowBigDownDashIcon size={16} /> Download
          </button>
          <button onClick={togglePublish} className='bg-linear-to-br from-indigo-700 to-indigo-600 hover:from-indigo-600 hover:to-indigo-500 text-white px-3.5 py-1 flex items-center gap-2 rounded sm:rounded-sm transition-colors'>
            {project. isPublished  ?
            <EyeOffIcon size={16} /> : <EyeIcon size={16} /> }
            {project.isPublished ? 'Unpublish' : 'Publish' }
          </button>
        </div>
      </div>
      <div className='flex-1 flex overflow-auto'>
        <Sidebar isMenuOpen ={isMenuOpen} project={project} setProject={(p)=>setProject(p)} isGenerating={isGenerating} setIsGenerating={setIsGenerating}/>
        <div className='flex-1 p-2 pl-0'>
          <ProjectPreview ref={previewRef} project = {project} isGenerating={isGenerating} device={device}/>
        </div>
      </div>
    </div>
  )
  :
  (
    <div className='flex items-center justify-center h-screen'>
      <p className='text-2xl font-medium text-gray-200'>Project not found.</p>
    </div>
  )
}

export default Projects
