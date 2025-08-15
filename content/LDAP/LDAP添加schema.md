# LDAP添加schema

```yaml
dn: cn=certInfo,cn=schema,cn=config
changetype: add
objectClass: olcSchemaConfig
cn: certInfo
olcObjectClasses: ( 1.3.6.1.4.1.18760.1.9.3.1 NAME 'certInfo' DESC '证书信息结构类' SUP top STRUCTURAL MUST ( c ) MAY ( cn $ l $ mail $ o $ ou $ serialNumber $ sn $ st $ telephoneNumber ) )
```

将上面的内容保存为一个`ldif`文件

![[certinfo.ldif]]

在LDAP服务器上使用root用户执行

```shell
ldapadd -Q -Y EXTERNAL -H ldapi:/// -f ~/certinfo.ldif
```

命令，最后的`~/certinfo.ldif`为保存的`ldif`文件的全路径